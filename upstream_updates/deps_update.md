# Dependency Update Instruction

Update the `graphql-upload-ts` dependency in `deps.ts` to version `2.1.4`.

## Change

In `deps.ts`, change:

```typescript
} from "npm:graphql-upload-ts@^2.1.3"
```

to:

```typescript
} from "npm:graphql-upload-ts@^2.1.4"
```

Updating this dependency will also pull in the latest validation helpers and error types that are re-exported by this file.
