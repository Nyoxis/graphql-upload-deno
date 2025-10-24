import {
  GraphQLHTTP,
  GQLOptions,

  OperationContext,

  GraphQLOperation,
  UploadOptions,

  Middleware,
  Request as OakRequest,
} from "../deps.ts";
import { processRequest as defaultProcessRequest } from "./process_request.ts";

type ProcessRequestFn = <T = GraphQLOperation | GraphQLOperation[]>(
  request: Request,
  options?: UploadOptions
) => Promise<T>;

export interface GraphqlUploadOakOptions extends UploadOptions {
  processRequest?: ProcessRequestFn;
}

/* Creates Oak middleware for GraphQL handling with multipart (file upload) requests.
 * See integration test: /src/graphql_upload_oak.integration.test.ts for usage examples.
 * Uses middleware https://github.com/deno-libs/gql
 * File uploading processing based on https://github.com/meabed/graphql-upload-ts
 */

export function graphqlHttpWithUploadOak<
  GqlContext extends OperationContext = { request: OakRequest },
>(
  uploadOptions: GraphqlUploadOakOptions = {},
  graphqlOption: GQLOptions<Request, { request: Request }, GqlContext> = {}
): Middleware {
  const { processRequest = defaultProcessRequest, ...uploadOptionsProcess } = uploadOptions;
  const handler = GraphQLHTTP<Request, GqlContext>({
    async parseRequestParams(req) {
      const contentType = req.raw.headers.get("content-type") || "";
      if (contentType.startsWith("multipart/form-data")) {
        // Parse multipart GraphQL upload
        const params = await processRequest(req.raw, uploadOptionsProcess);
        if (Array.isArray(params)) {
          throw new Error('Batching is not supported');
        }
        return {
          ...params,
          variables: params.variables
        }
      }
    },
    ...graphqlOption
  })
  return async function graphqlHTTPWithUploadOakMiddleware(ctx, next) {
    // cast Oak request into a normal Request
    if (!ctx.request.source) {
      throw new Error("no request")
    }
    const res = await handler(ctx.request.source)

    for (const [k, v] of res.headers.entries()) ctx.response.headers.append(k, v)

    ctx.response.status = res.status
    ctx.response.body = await res.text()
    await next();
  };
}