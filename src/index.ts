import { Probot, Context } from 'probot'
import fs from 'fs'

const blacklistedStrings = ['do-not-merge', "dnl", 'wip']

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
    if (allReviews.some((r: any) => r.state === 'APPROVED') && context.payload.action !== 'dismissed') {
      context.log('PR already has approvals from at least one reviewer. Skipping auto-approval.')
      return
    }

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
      return
    }

    const autoapprovalReviews = allReviews.filter((item: any) => item.user.login === 'autoapproval[bot]')

    if (autoapprovalReviews.length > 0) {
      context.log('PR has already reviews')
      if (context.payload.action === 'dismissed') {
        approvePullRequest(context)
        setActionOutput('approved', 'true')
        setActionOutput('auto_approve_reason', reason)
        context.log('Review was dismissed, approve again')
      }
    } else {
      approvePullRequest(context)
      applyLabels(context, ["auto_approved"])
      setActionOutput('approved', 'true')
      setActionOutput('auto_approve_reason', reason)
      context.log('PR approved first time')
    }
  })
}

async function approvePullRequest (context: Context) {
  const prParams = context.pullRequest({ event: 'APPROVE' as const, body: 'Approved :+1:' })
  await context.octokit.pulls.createReview(prParams)
}

async function applyLabels (context: Context, labels: string[]) {
  // if there are labels required to be added, add them
  if (labels.length > 0) {
    // trying to apply existing labels to PR. If labels didn't exist, this call will fail
    const labelsParam = context.issue({ labels: labels })
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
