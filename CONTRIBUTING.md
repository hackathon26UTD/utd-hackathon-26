# Team workflow

Keep `main` working. Each issue has one owner, acceptance criteria, and a small scope.

```sh
git switch main
git pull --ff-only
git switch -c feat/short-description
# Make and verify your change.
git add path/to/changed-file
git commit -m "Add short description"
git push -u origin HEAD
gh pr create
```

Use `fix/` or `docs/` for other branches. Link the issue with `Closes #NUMBER` in the pull request. Ask one teammate to review, resolve feedback, then squash merge and delete the branch. Pull main before starting the next task. Avoid changing another person's active files without coordinating.

Before review: run the relevant tests, verify the main user journey, check for secrets, and include screenshots for UI changes. If a change cannot be fully verified, state what remains in the PR.

The repo owner should configure a main-branch ruleset requiring one approval and passing CI if the account plan supports it. This starter documents that workflow; it does not enforce branch protection. Add application checks to CI before making them required.

When blocked for more than 15 minutes, post the blocker in the issue and pair with a teammate. Freeze new features before the submission deadline and focus on the demo, deployment, and submission.
