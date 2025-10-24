import { superoak } from "../dev_deps.ts";
import { Application, Router } from "../deps.ts";
import { graphqlHttpWithUploadOak } from "./graphql_upload_oak.ts";
import { GraphQLUpload } from "./graphql-upload.ts"
import { FileUpload } from "./upload.ts";

import { makeExecutableSchema, gql } from "../dev_deps.ts";

const typeDefs = gql`
  scalar Upload

  type Mutation {
    upload(file: Upload!): String
  }

  type Query {
    _empty: String
  }
`;

const resolvers = {
  Upload: GraphQLUpload,
  Mutation: {
    upload: async (_parent: unknown, { file }: {file: Promise<FileUpload>}) => {
      const resolved_file = await file
      return await new Response(resolved_file.content).text();
    },
  },
  Query: {
    _empty: () => "ok",
  },
};

const schema = makeExecutableSchema({ typeDefs, resolvers });


Deno.test("multipart request returns file content", async () => {
  const app = new Application();
  const router = new Router();
  // simple error handler
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      ctx.response.status = (error as { status?: number })?.status ?? 500;
      ctx.response.type = "application/json";
      ctx.response.body = {
        errors: [{ message: (error as Error)?.message ?? "Unknown error", extensions: { code: (error as { code?: string })?.code || "INTERNAL_SERVER_ERROR" } }],
      };
    }
  });
  router.post(
    "/graphql",
    graphqlHttpWithUploadOak({}, {
      schema
    })
  );

  app.use(router.routes());

  const testClient = await superoak(app);

  // Fake multipart body missing `map`
  await testClient
    .post("/graphql")
    .field(
      "operations",
      JSON.stringify({
        query: "mutation ($file: Upload!) { upload(file: $file) }",
        variables: { file: null },
      }),
    )
    .field("map", JSON.stringify({ "1": ["variables.file"] }))
    .attach("1", new Blob(["Hello world"], { type: "text/plain" }), "hello.txt")
    .expect((res) => {
      if (res.status !== 200) {
        throw new Error(`Request failed with status ${res.status}: ${JSON.stringify(res.body)}`);
      }
    })
    .expect(200)
    .expect("Content-Type", /json/)
    .expect({ data: { upload: "Hello world" } });
});