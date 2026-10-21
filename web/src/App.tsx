import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router";
import { createQueryClient } from "./api/queryClient";
import { Layout } from "./components/Layout";
import { HowPage } from "./pages/HowPage";
import { LivePage } from "./pages/LivePage";
import { SearchPage } from "./pages/SearchPage";

const TITLES: Record<string, string> = {
  "/": "RU SnipeZ · Live Rutgers open seats",
  "/search": "Search sections · RU SnipeZ",
  "/how-it-works": "How it works · RU SnipeZ",
};

function DocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = TITLES[pathname] ?? "Page not found · RU SnipeZ";
  }, [pathname]);
  return null;
}

function NotFound() {
  return (
    <section className="page-head">
      <h1>Page not found</h1>
      <p className="lead">
        <Link to="/">Go to the live feed</Link>
      </p>
    </section>
  );
}

export function AppRoutes() {
  return (
    <>
      <DocumentTitle />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<LivePage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="how-it-works" element={<HowPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}

export function App() {
  // One client for the app's lifetime; it holds the query cache.
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
