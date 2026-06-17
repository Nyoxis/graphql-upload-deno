# Logic Updates Instructions

The upstream version `2.1.4` of `graphql-upload-ts` introduced a check to ensure that the path being set in `operations` is initially `null`, conforming to the GraphQL multipart request specification.

## File: `src/process_request.ts`

Apply the following diff to `src/process_request.ts`:

```diff
<<<<<<< SEARCH
      try {
        operationsPath.set(path, map.get(fieldName)); // ensures it's the same object
      } catch {
=======
      try {
        if (operationsPath.get(path) !== null) {
          throw new Error("Invalid object path");
        }
        operationsPath.set(path, map.get(fieldName)); // ensures it's the same object
      } catch {
>>>>>>> REPLACE
```

This change ensures that we only map files to fields that are explicitly set to `null` in the `operations` object, as required by the spec.
