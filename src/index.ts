import { Probot, Context } from 'probot'
import fs from 'fs'

const blacklistedStrings = ['[do-not-merge]', '[dnl]', '[wip]']
const autoapprovalBotLogin = 'autoapproval[bot]'
const agentNameIndicators = ['devin', 'cursor', 'claude', 'codex']
const agentBranchPrefixes = agentNameIndicators.map((name) => `${name}/`)
const requiredApprovalsForAgentPr = 2
const changesRequestedReviewState = 'CHANGES_REQUESTED'
const approvedReviewState = 'APPROVED'

module.exports = (app: Probot) => {
  app.on(['pull_request.opened', 'pull_request.reopened', 'pull_request.labeled', 'pull_request.edited', 'pull_request_review'], async (context) => {
    context.log('Repo: %s', context.payload.repository.full_name)

    const pr = context.payload.pull_request
    context.log('PR: %s', pr.html_url)
    context.log('Action: %s', context.payload.action)

    // initialize default outputs for the GitHub Action
    setActionOutput('approved', 'false')
    setActionOutput('auto_approve_reason', '')
    setActionOutput('pr_author', pr.user.login || '')

    // NOTE(dabrady) When a PR is first opened, it can fire several different kinds of events if the author e.g. requests
    // reviewers or adds labels during creation. This triggers parallel runs of our GitHub App, so we need to filter out
    // those simultaneous events and focus just on the re/open event in this scenario.
    //
    // These simultaneous events contain the same pull request data in their payloads, and specify the 'updated at'
    // timestamp to be the same as the 'created at' timestamp for the pull request. We can use this to distinguish events
    // that are fired during creation from events fired later on.
    if (!['opened', 'reopened'].includes(context.payload.action) && pr.created_at === pr.updated_at) {
      context.log('Ignoring additional creation event: %s', context.payload.action)
      return
    }

    // reading configuration
    const config: any = await context.config('autoapproval.yml')
    context.log(config, '\n\nLoaded config')

    const prTitle = (pr.title || '').toLowerCase()
    const blacklistedInTitle = blacklistedStrings.filter((s: string) => prTitle.toLowerCase().includes(`${s.toLowerCase()}`))
    if (blacklistedInTitle.length > 0) {
      context.log('PR title contains blacklisted term(s): %s', blacklistedInTitle)
      return
    }

    // determine if the PR has any "blacklisted" labels
    const prLabels: string[] = pr.labels.map((label: any) => label.name.toLowerCase())
    const blacklistedLabels = blacklistedStrings
      .filter((blacklistedLabel: string) => prLabels.includes(blacklistedLabel))

    // if PR contains any black listed labels, do not proceed further
    if (blacklistedLabels.length > 0) {
      context.log('PR black listed from approving: %s', blacklistedLabels)
      return
    }

    const prParamsForReviews = context.pullRequest()
    const allReviewsResponse = await context.octokit.pulls.listReviews(prParamsForReviews)
    const allReviews = allReviewsResponse.data
    const latestReviewsByUser = getLatestReviewsByUser(allReviews)
    const isAgentGenerated = await isAgentGeneratedPullRequest(context, pr)
    const reviewerApprovals = countNonBotApprovalsExcludingAutoapproval(latestReviewsByUser)
    const needsAgentReviewBlock = isAgentGenerated && reviewerApprovals < requiredApprovalsForAgentPr
    const hasAnyAutoapprovalReview = allReviews.some((review: any) => review?.user?.login === autoapprovalBotLogin)
    const hasAnyAutoapprovalApproval = allReviews.some((review: any) => {
      return review?.user?.login === autoapprovalBotLogin && (review?.state || '').toUpperCase() === approvedReviewState
    })
    let latestAutoapprovalReviewState = ((latestReviewsByUser.get(autoapprovalBotLogin)?.state || '') as string).toUpperCase()

    // // reading pull request owner info and check it with configuration
    // const ownerSatisfied = config.from_owner.length === 0 || config.from_owner.includes(pr.user.login)

    // // reading pull request labels and check them with configuration
    // let requiredLabelsSatisfied
    // if (config.required_labels_mode === 'one_of') {
    //   // one of the required_labels needs to be applied
    //   const appliedRequiredLabels = config.required_labels
    //     .filter((requiredLabel: any) => prLabels.includes(requiredLabel))
    //   requiredLabelsSatisfied = appliedRequiredLabels.length > 0
    // } else {
    //   // all of the required_labels need to be applied
    //   const missingRequiredLabels = config.required_labels
    //     .filter((requiredLabel: any) => !prLabels.includes(requiredLabel))
    //   requiredLabelsSatisfied = missingRequiredLabels.length === 0
    // }
    // if (!requiredLabelsSatisfied || !ownerSatisfied) {
    //   context.log('PR does not meet approval criteria')
    //   context.log('Condition failed! \n - missing required labels: %s\n - PR owner found: %s', requiredLabelsSatisfied, ownerSatisfied)
    //   return
    // }

    // extract the auto-approve reason from PR description
    const reason = extractAutoApproveReason(pr.body || '')
    if (!reason) {
      context.log('Missing required "auto-approve reason: <text>" in PR description. Skipping approval.')
    } else {
      const shouldApproveWhileBlocked = needsAgentReviewBlock && !hasAnyAutoapprovalApproval
      const shouldApproveNormally = !needsAgentReviewBlock && (latestAutoapprovalReviewState !== approvedReviewState || context.payload.action === 'dismissed')

      if (shouldApproveWhileBlocked || shouldApproveNormally) {
        await approvePullRequest(context)
        latestAutoapprovalReviewState = approvedReviewState
        if (!hasAnyAutoapprovalReview) {
          await applyLabels(context, ['auto_approved'])
        }
        setActionOutput('approved', 'true')
        setActionOutput('auto_approve_reason', reason)

        if (context.payload.action === 'dismissed') {
          context.log('Review was dismissed, approve again')
        } else {
          context.log('PR approved')
        }
      } else {
        context.log('PR already has an active autoapproval approval review')
      }
    }

    if (needsAgentReviewBlock) {
      if (latestAutoapprovalReviewState !== changesRequestedReviewState) {
        await requestChangesOnPullRequest(context, reviewerApprovals)
        latestAutoapprovalReviewState = changesRequestedReviewState
      }
      context.log('Agent-generated PR is blocked: %d/%d required non-bot approvals from other reviewers.', reviewerApprovals, requiredApprovalsForAgentPr)
    } else if (isAgentGenerated) {
      context.log('Agent-generated PR has enough non-bot approvals from other reviewers: %d/%d.', reviewerApprovals, requiredApprovalsForAgentPr)
    }
  })
}

async function approvePullRequest (context: Context) {
  const prParams = context.pullRequest({ event: 'APPROVE' as const, body: 'Approved :+1:' })
  await context.octokit.pulls.createReview(prParams)
}

async function requestChangesOnPullRequest (context: Context, reviewerApprovals: number) {
  const body = `This PR appears to be generated by a coding agent. It requires ${requiredApprovalsForAgentPr} non-bot approvals from other reviewers before merge. Current non-bot approvals: ${reviewerApprovals}.`
  const prParams = context.pullRequest({ event: 'REQUEST_CHANGES' as const, body })
  await context.octokit.pulls.createReview(prParams)
}

async function applyLabels (context: Context, labels: string[]) {
  // if there are labels required to be added, add them
  if (labels.length > 0) {
    // trying to apply existing labels to PR. If labels didn't exist, this call will fail
    const labelsParam = context.issue({ labels })
    await context.octokit.issues.addLabels(labelsParam)
  }
}

function extractAutoApproveReason (body: string): string | null {
  const lines = body.split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^auto-approve reason:\s*(.+)\s*$/i)
    if (match && match[1] && match[1].trim().length > 0) {
      return match[1].trim()
    }
  }
  return null
}

async function isAgentGeneratedPullRequest (context: Context, pr: any): Promise<boolean> {
  const branchName = (pr?.head?.ref || '').toLowerCase()
  if (agentBranchPrefixes.some((prefix) => branchName.startsWith(prefix))) {
    return true
  }

  if (!pr?.head?.ref) {
    return false
  }

  const commits = await context.octokit.paginate(context.octokit.pulls.listCommits, context.pullRequest({ per_page: 100 }))
  return commits.some(commitHasAgentCoAuthor)
}

function commitHasAgentCoAuthor (commit: any): boolean {
  const commitMessage = commit?.commit?.message
  if (!commitMessage) {
    return false
  }

  for (const line of commitMessage.split(/\r?\n/)) {
    const match = line.match(/^co-authored-by:\s*(.+?)\s*<[^>]+>\s*$/i)
    if (!match || !match[1]) {
      continue
    }

    const coAuthorName = match[1].trim().toLowerCase()
    const hasBotSuffix = coAuthorName.includes('[bot]')
    const hasAgentIndicator = agentNameIndicators.some((name) => coAuthorName.includes(name))
    if (hasBotSuffix && hasAgentIndicator) {
      return true
    }
  }

  return false
}

function getLatestReviewsByUser (reviews: any[]): Map<string, any> {
  const latestReviewsByUser = new Map<string, any>()
  for (const review of reviews) {
    const login = review?.user?.login
    if (!login) {
      continue
    }
    latestReviewsByUser.set(login, review)
  }
  return latestReviewsByUser
}

function countNonBotApprovalsExcludingAutoapproval (latestReviewsByUser: Map<string, any>): number {
  let count = 0
  latestReviewsByUser.forEach((review, login) => {
    if (login === autoapprovalBotLogin) {
      return
    }

    const isBot = review?.user?.type === 'Bot' || login.toLowerCase().endsWith('[bot]')
    if (isBot) {
      return
    }

    if ((review?.state || '').toUpperCase() === 'APPROVED') {
      count += 1
    }
  })

  return count
}

function setActionOutput (name: string, value: string) {
  const ghOutput = process.env.GITHUB_OUTPUT
  if (!ghOutput) return
  // Use multiline-safe syntax to avoid issues with special characters
  const delimiter = 'EOF_' + name
  try {
    fs.appendFileSync(ghOutput, `${name}<<${delimiter}\n${value}\n${delimiter}\n`)
  } catch (e) {
    // best-effort; log and continue
    // @ts-ignore
    console.error('Failed to write action output', name, e)
  }
}
