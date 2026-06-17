# Node.js Support Update Instructions

Upstream `graphql-upload-ts` version `2.1.4` has officially dropped support for Node.js 18. This project should reflect this change in its documentation and CI/CD environment to maintain alignment.

## Actions

1. **Update README.md**: If there are any mentions of Node.js support versions, update them to indicate Node.js >= 20.
2. **CI/CD**: Any GitHub Actions workflows should be reviewed to ensure they use Node.js 20 or 24 (upstream uses Node.js 24 in its latest CI).
