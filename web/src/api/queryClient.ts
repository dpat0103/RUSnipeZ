import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./client";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A 4xx will not fix itself; retry only network and server errors.
        retry: (failures, error) => !(error instanceof ApiError && error.status < 500) && failures < 3,
      },
    },
  });
}
