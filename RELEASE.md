# Web Apps Release Instructions

This document outlines the standard process for releasing updates to web applications following semantic versioning principles.

## Example: Web Wallet v1.1.0 Release

### 1. Create a Release Issue

- Create a new issue in the project repository
- Title: `Release Web Wallet v1.1.0` or `web-wallet: Release v1.1.0`, if using prefix to the issue title
- Add appropriate labels (e.g. module: `web-wallet`, type: `task`)

### 2. Create a Release Branch

- Create a branch from the latest `main`
- Name the branch using the issue number (e.g., `feature-ABC-123`)
- **Note:** Do not use version numbers for branch names to avoid conflicts with tags

```bash
git checkout main
git pull
git checkout -b feature-ABC-123
```

### 3. Update Version Number

- Use npm version commands to bump version according to semantic versioning:
  - `npm version patch` (for bug fixes and minor changes)
  - `npm version minor` (for new features, backward compatible)
  - `npm version major` (for breaking changes)
- For this example: `npm version minor`

```bash
npm version minor
```

### 4. Update the CHANGELOG.md

- Add a new section for the version being released
- Copy relevant changes from "Unreleased" section to the new version section
- Keep the "Unreleased" section with any features that remain hidden to users
- Ensure the format follows the project's changelog conventions
- Add the version to the bottom of the changelog under "Versions"

Example CHANGELOG.md format:

```markdown
# Changelog

All notable changes to Web Wallet will be documented in this file.

## [Unreleased]

- New analytics dashboard layout (in progress)
- Experimental dark mode theme

## [1.1.0] - 2025-04-22

### Added

- Multi-account support
- Export functionality for transaction history
- Enhanced filtering options

### Changed

- Improved loading performance by 35%
- Updated UI components for better mobile experience

### Fixed

- Transaction history pagination issue
- Search functionality in asset explorer

## [1.0.1] - 2025-03-15

...

<!-- VERSIONS -->

[1.1.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v1.1.0
[1.0.0]: https://github.com/dusk-network/web-wallet/tree/web-wallet-v1.0.0
```

### 5. Create and Review Pull Request

- Commit and push the changes
- Open a PR targeting `main`
- Copy the changelog section for the new version into the PR description
- Request code review from team members

```bash
git add CHANGELOG.md package.json package-lock.json
git commit -m "web-wallet: Release v1.1.0"
git push origin feature-ABC-123
```

### 6. Create Annotated Tag

**Option A: Tag from branch (after approval)**

```bash
git tag -a web-wallet-v1.1.0 -m "Web Wallet: Release v1.1.0"
```

**Option B: Merge to main then tag (recommended)**

```bash
git checkout main
git pull
git tag -a web-wallet-v1.1.0 -m "Web Wallet: Release v1.1.0"
```

**Important note:** Ensure the tag name (`web-wallet-v1.1.0`) matches exactly with the entry added to the CHANGELOG.md in step 4.

### 7. Push the Tag

```bash
git push origin web-wallet-v1.1.0
```

### 8. Progressive Deployment on Production

Deploy the new version progressively through each environment:

1. **Devnet**
   - Deploy to development network, on DigitalOcean
   - Verify functionality
   - Address any issues before proceeding

2. **Testnet**
   - Deploy to test network after devnet validation: push a `deploy/web-wallet-testnet*` branch, the release with what only testnet takes, and the Deploy workflow builds it and deploys it to Cloudflare
   - Run comprehensive tests
   - Verify integrations with other systems

3. **Mainnet**
   - Deploy to production after successful testnet validation, on DigitalOcean until v2; from then, the tag deploys it through the Deploy workflow (README, Deploying)
   - Monitor deployment closely

### 9. Troubleshooting Deployment

If errors occur during deployment:

- On Cloudflare, check the Deploy workflow's log; if it failed before deploying, run it again: nothing has changed on the site
- On DigitalOcean, try rebuilding with the "clear cache" option enabled
- Check build logs for specific errors
- Verify the settings are correct: testnet's in `deployments.json`, the others' in their DigitalOcean spec too
- Confirm that all dependencies are properly resolved

### 10. Final Validation

- Confirm the application works correctly across all production environments
- Verify the product version displayed in the UI matches the released version
- Run `node scripts/verify-build.js <site>` for each environment: every file it serves should be what its commit builds
- Test all key user flows and features on different devices and browsers
- Monitor error logs and performance metrics

### 11. Announce the Release

- Notify marketing team to prepare community announcement
- Directly inform stakeholders whose requested features or fixes are included
- Provide specific details to team members about changes that affect their work
- Consider posting in relevant Discord channels, email lists, or other communication platforms
- For major releases, coordinate with marketing on blog posts or social media announcements

## Rollback Procedure (If Needed)

If critical issues are discovered after deployment:

1. Identify the last stable tag/version
2. Deploy the previous stable version to affected environments: on Cloudflare, roll the Worker back to its version before, or run the Deploy workflow on the deploy branch that was there
3. Create a hotfix branch from the stable tag
4. Fix the issue and follow an expedited version of the release process
5. Communicate transparently about the issue and resolution

## Release Checklist

- [ ] Create issue for release
- [ ] Create feature branch with issue number
- [ ] Update version with npm version command
- [ ] Update CHANGELOG.md
- [ ] Open and get approval on PR
- [ ] Create and push annotated tag
- [ ] Deploy to devnet and verify
- [ ] Deploy to testnet and verify
- [ ] Deploy to mainnet and verify
- [ ] Final validation across environments
- [ ] Announce release to stakeholders
