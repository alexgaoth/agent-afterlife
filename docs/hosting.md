# Hosting your own site

`agent-afterlife build <source> --out <folder>` writes a static folder: the temple, the graveyard, the text
version and your data. Any static host serves it. One command writes the file each host needs:

```sh
npx agent-afterlife init                 # GitHub Pages (a workflow; source: the repo's agent PRs)
npx agent-afterlife init --ci gitlab      # GitLab Pages (.gitlab-ci.yml; source: the repo's commits)
npx agent-afterlife init --ci netlify     # Netlify (netlify.toml; source: the repo's commits)
```

Add `--source <source>` for any other source (`--source data/agents.csv` also writes example rows). Then edit the
file for the merit formula, a title or `--anonymize`.

## GitHub Pages

`init` writes `.github/workflows/afterlife.yml`: it builds on every push and every morning, then deploys with
`actions/deploy-pages`. One-time setup: **Settings > Pages > Build and deployment > Source: GitHub Actions**. The
workflow uses the action (`uses: alexgaoth/agent-afterlife@main`), which takes the same sources and options as
the command. See the README's "Your own site on GitHub Pages".

## GitLab Pages

`init --ci gitlab` writes `.gitlab-ci.yml` with one job, `pages`, that runs `build … --out public` in a `node:22`
image and publishes `public/`. Push to the default branch; **Deploy > Pages** shows the address. For a daily
rebuild, add a schedule under **Build > Pipeline schedules**. `GIT_DEPTH: 0` lets the `git` source read the whole
history. To read GitHub pull requests from GitLab, set a `GITHUB_TOKEN` CI/CD variable and use `--source "github owner/repo"`.

## Netlify

`init --ci netlify` writes `netlify.toml`: build command `npx -y agent-afterlife build … --out site`,
publish folder `site`, Node 22. Import the repository on Netlify and it reads the file. For a daily rebuild, create
a build hook (**Site configuration > Build hooks**) and call it from any scheduler (a cron job, a GitHub Actions
schedule).

## Cloudflare Pages

In **Workers & Pages > Create > Pages > Connect to Git**, set:

| Setting | Value |
|---|---|
| Build command | `npx -y agent-afterlife build git . --out site` (or your source) |
| Build output directory | `site` |
| Environment variable | `NODE_VERSION` = `22` |

Or build anywhere and upload: `npx wrangler pages deploy site`.

## Any static host, or your own server

```sh
npx -y agent-afterlife build claude-code --out site --anonymize
rsync -a site/ server:/var/www/afterlife/           # or: aws s3 sync site/ s3://bucket/ ; or any web server
```

On the machine where your agents run, a cron line keeps it fresh (see the
[cron walkthrough](walkthrough-cron.md)):

```sh
30 2 * * *  npx -y agent-afterlife build claude-code --out /var/www/afterlife --anonymize
```

A build with a URL as its source (`build https://…/afterlife.json --out site`) does not copy the data: the pages
read that URL on every visit, so the site shows the newest data without a rebuild.

Before a public site, read [Before you publish](../ADAPTERS.md#before-you-publish).
