import { pageItems } from "../lib/pagination";

export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Results pages">
      <button className="page-button" disabled={page === 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="page-numbers">
        {pageItems(page, pages).map((item, i) =>
          item === "gap" ? (
            <span key={`gap-${i}`} className="page-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={item}
              className="page-button"
              aria-current={item === page ? "page" : undefined}
              aria-label={`Page ${item}`}
              onClick={() => onPage(item)}
            >
              {item}
            </button>
          ),
        )}
      </span>
      <span className="page-status">
        Page {page} of {pages}
      </span>
      <button className="page-button" disabled={page === pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}
