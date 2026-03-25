import nock from 'nock'

const myProbotApp = require('../src')
const { Probot, ProbotOctokit } = require('probot')

nock.disableNetConnect()

describe('Agent-generated PR requirements', () => {
  let probot: any

  beforeEach(() => {
    probot = new Probot({
      githubToken: 'test',
      Octokit: ProbotOctokit.defaults({
        retry: { enabled: false },
        throttle: { enabled: false }
      })
    })
    myProbotApp(probot)
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  test('agent branch with fewer than 2 non-bot approvals posts request changes without failing workflow', async () => {
    const payload = createPayload({ branch: 'codex/feature-1' })

    mockConfig()

    nock('https://api.github.com')
      .get('/repos/dkhmelenko/autoapproval/pulls/1/reviews')
      .reply(200, [])

    nock('https://api.github.com')
      .post('/repos/dkhmelenko/autoapproval/pulls/1/reviews', (body: any) => body.event === 'APPROVE')
      .reply(200)

    nock('https://api.github.com')
      .post('/repos/dkhmelenko/autoapproval/issues/1/labels', (body: any) => body.labels.includes('auto_approved'))
      .reply(200)

    nock('https://api.github.com')
      .post('/repos/dkhmelenko/autoapproval/pulls/1/reviews', (body: any) => body.event === 'REQUEST_CHANGES')
      .reply(200)

    await expect(probot.receive({ name: 'pull_request', payload })).resolves.toBeUndefined()

    await new Promise(process.nextTick)
    expect(nock.isDone()).toBeTruthy()
  })

  test('agent branch with 2 non-bot approvals clears requested changes by approving', async () => {
    const payload = createPayload({ branch: 'cursor/refactor' })

    mockConfig()

    nock('https://api.github.com')
      .get('/repos/dkhmelenko/autoapproval/pulls/1/reviews')
      .reply(200, [
        {
          user: { login: 'autoapproval[bot]', type: 'Bot' },
          state: 'CHANGES_REQUESTED'
        },
        {
          user: { login: 'alice', type: 'User' },
          state: 'APPROVED'
        },
        {
          user: { login: 'bob', type: 'User' },
          state: 'APPROVED'
        }
      ])

    nock('https://api.github.com')
      .post('/repos/dkhmelenko/autoapproval/pulls/1/reviews', (body: any) => body.event === 'APPROVE')
      .reply(200)

    await expect(probot.receive({ name: 'pull_request', payload })).resolves.toBeUndefined()

    await new Promise(process.nextTick)
    expect(nock.isDone()).toBeTruthy()
  })

  test('co-author detection triggers request changes even when branch prefix does not match', async () => {
    const payload = createPayload({ branch: 'feature/normal-branch' })

    mockConfig()

    nock('https://api.github.com')
      .get('/repos/dkhmelenko/autoapproval/pulls/1/reviews')
      .reply(200, [])

    nock('https://api.github.com')
      .get('/repos/dkhmelenko/autoapproval/pulls/1/commits')
      .query(true)
      .reply(200, [
        {
          commit: {
            message: 'Some change\n\nCo-authored-by: Codex [bot] <codex@example.com>'
          }
        }
      ])

    nock('https://api.github.com')
      .post('/repos/dkhmelenko/autoapproval/pulls/1/reviews', (body: any) => body.event === 'APPROVE')
      .reply(200)

    nock('https://api.github.com')
      .post('/repos/dkhmelenko/autoapproval/issues/1/labels', (body: any) => body.labels.includes('auto_approved'))
      .reply(200)

    nock('https://api.github.com')
      .post('/repos/dkhmelenko/autoapproval/pulls/1/reviews', (body: any) => body.event === 'REQUEST_CHANGES')
      .reply(200)

    await expect(probot.receive({ name: 'pull_request', payload })).resolves.toBeUndefined()

    await new Promise(process.nextTick)
    expect(nock.isDone()).toBeTruthy()
  })
})

function mockConfig () {
  const config = 'from_owner: []\nrequired_labels: []\napply_labels: []'

  nock('https://api.github.com')
    .get('/repos/dkhmelenko/autoapproval/contents/.github%2Fautoapproval.yml')
    .reply(200, config)
}

function createPayload ({ branch }: { branch: string }) {
  return {
    action: 'opened',
    pull_request: {
      number: 1,
      html_url: 'https://github.com/dkhmelenko/autoapproval/pull/1',
      created_at: '2022-03-30T15:17:37.000+02:00',
      updated_at: '2022-03-30T15:17:37.000+02:00',
      title: 'Feature PR',
      body: 'auto-approve reason: Valid reason provided',
      user: {
        login: 'dkhmelenko'
      },
      head: {
        ref: branch
      },
      labels: []
    },
    repository: {
      name: 'autoapproval',
      full_name: 'dkhmelenko/autoapproval',
      owner: {
        login: 'dkhmelenko'
      }
    }
  }
}
