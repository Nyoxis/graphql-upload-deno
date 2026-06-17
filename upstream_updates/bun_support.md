# Bun Support and Chores

Upstream version `2.1.4` added explicit support for Bun in its build and test workflows.

## Recommended Chores

1. **Bun Tests**: Upstream added `test:bun` and `validate:bun` scripts. You may want to add similar tasks to your `deno.json` or a `package.json` if you use Bun for testing.
   - Upstream `test:bun`: `bun test --timeout 30000`
2. **CI Workflows**: Upstream added a `test-bun` job to their CI:
   ```yaml
   test-bun:
     name: Test (Bun)
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v6
       - uses: oven-sh/setup-bun@v2
         with:
           bun-version: 1.3.13
       - run: bun install --frozen-lockfile
       - run: bun run validate:bun
   ```
3. **Actions Versions**: Upstream updated several GitHub Actions to their latest versions (e.g., `actions/checkout@v6`, `actions/setup-node@v6`).
