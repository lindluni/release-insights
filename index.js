const fs = require('fs')
const cliProgress = require('cli-progress');
const yargs = require('yargs/yargs')
const {hideBin} = require('yargs/helpers')
const {Octokit} = require("@octokit/rest");

const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
})

async function run(owner, repo, base, head, jiraID) {
    await fs.writeFileSync('audit-machine.csv', `JiraID,CommitMessage,Author,PullRequestURL,CommitURL,PullRequestNote\n`)
    await fs.writeFileSync('audit-human.csv', `JiraID,CommitMessage,Author,PullRequestURL,CommitURL,PullRequestNote\n`)

    const pullRequests = await getPullRequests(owner, repo)
    await fs.writeFileSync('pr.json', JSON.stringify(pullRequests))
    const comparison = await compareTags(owner, repo, base, head)
    for (const commit of comparison.commits) {
        const pullRequest = await searchPullRequestForCommit(pullRequests, commit.sha)
        if (pullRequest) {
            const jiraIssueID = pullRequest.title.match(`${jiraID}-[0-9]+`) || commit.commit.message.match(`${jiraID}-[0-9]+`) || pullRequest.head.ref.match(`${jiraID}-[0-9]+`)
            const pullRequestNote = pullRequest.body.replace(/"/g, `'`)
            const author = commit.commit.author.name
            const pullRequestUrl = pullRequest.html_url
            const commitURL = commit.html_url

            let commitMessage = commit.commit.message.replace(/"/g, `'`)
            if (commitMessage.startsWith('-')) {
                commitMessage = commitMessage.substr(1, commitMessage.length)
            }

            if (jiraIssueID === null) {
                await fs.appendFileSync('audit-machine.csv', `"","${commitMessage}","${author}","${pullRequestUrl}","${commitURL}","${pullRequestNote}"\n`)
                await fs.appendFileSync('audit-human.csv', `"",${JSON.stringify(commitMessage)},"${author}","${pullRequestUrl}","${commitURL},${JSON.stringify(pullRequestNote)}\n`)
            } else {
                const id = jiraIssueID[0].replace(/\s/g, '-').replace(/--/g, '-')
                await fs.appendFileSync('audit-machine.csv', `"${id}","${commitMessage}","${author}","${pullRequestUrl}","${commitURL}","${pullRequestNote}"\n`)
                await fs.appendFileSync('audit-human.csv', `"${id}",${JSON.stringify(commitMessage)},"${author}","${pullRequestUrl}","${commitURL},${JSON.stringify(pullRequestNote)}\n`)
            }
        }
    }
}

async function compareTags(owner, repo, base, head) {
    const comparison = await octokit.repos.compareCommits({
        owner: owner,
        repo: repo,
        base: base,
        head: head,
        per_page: 100
    })
    return comparison.data
}

async function getPullRequests(owner, repo) {
    console.log(`Downloading all Pull Request data`)
    const pulls = await octokit.paginate(octokit.pulls.list, {
        owner: owner,
        repo: repo,
        state: 'all',
        per_page: 100
    })
    console.log('Downloading commit data from Pull Requests')
    const pullsBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    pullsBar.start(pulls.length, 0);
    for (let i = 0; i < pulls.length; i++) {
        pullsBar.update(i)
        pulls[i]['commitData'] = await octokit.paginate(octokit.pulls.listCommits, {
            owner: owner,
            repo: repo,
            pull_number: pulls[i].number,
            per_page: 100
        })
    }
    pullsBar.stop()
    return pulls
}

async function searchPullRequestForCommit(pullRequests, sha) {
    for (const pullRequest of pullRequests) {
        for (const commit of pullRequest.commitData) {
            if (commit.sha === sha) {
                return pullRequest
            }
        }
    }
}

yargs(hideBin(process.argv))
    .command('query', '-- generate an audit of commits contained between two releases or branches', (yargs) => {
        yargs
            .option('org', {
                alias: 'o',
                type: 'string',
                describe: 'The GitHub organization to query'
            })
            .option('repo', {
                alias: 'r',
                type: 'string',
                describe: 'The GitHub repository to query'
            })
            .option('base', {
                alias: 'b',
                type: 'string',
                describe: 'The base branch or release to perform the query on'
            })
            .option('head', {
                alias: 'h',
                type: 'string',
                describe: 'The head branch or release to perform the query on'
            })
            .option('key', {
                alias: 'k',
                type: 'string',
                describe: 'The Jira project key to search for, i.e., [JP]'
            })
    }, async (argv) => {
        try {
            await run(argv.org, argv.repo, argv.base, argv.head, argv.key)
        } catch (err) {
            // console.log(err)
        }
    })
    .alias('o', 'org')
    .alias('r', 'repo')
    .alias('b', 'base')
    .alias('h', 'head')
    .alias('k', 'key')
    .demandOption(['org', 'repo', 'base', 'head', 'key'])
    .scriptName('gh-insights')
    .wrap(null)
    .help()
    .argv
