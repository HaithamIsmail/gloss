import { BookOpen, Highlighter, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { BookListItem } from "../../shared/api";
import { BOOK_STATUS_LABEL, bookProgressLabel, type BookStatus } from "../../shared/pages";
import { useBooks, useTree } from "../api";
import { startBookImport } from "../books/importBook";
import { plural } from "./HomePage";

type Filter = "all" | BookStatus;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "reading", label: "Reading" },
  { id: "unread", label: "To read" },
  { id: "done", label: "Finished" },
];

const COURSE_KEY = "gloss-library-course";

/** Every book, in a course or not: covers, where you are in each, and a way to add more. */
export function LibraryPage() {
  const navigate = useNavigate();
  const { data: books = [], isLoading } = useBooks();
  const { data: tree } = useTree();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [courseId, setCourseId] = useState(() => {
    try {
      return localStorage.getItem(COURSE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const courses = tree?.courses ?? [];
  // "" = no course: the book lives in the library only.
  const targetCourse = courses.find((c) => c.id === courseId)?.id ?? "";

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = (s: string) => s.toLowerCase().includes(needle);
    return books
      .filter((b) => filter === "all" || b.book.status === filter)
      .filter((b) => !needle || hit(b.title) || hit(b.book.meta.authors) || hit(b.courseName) || b.book.meta.tags.some(hit))
      .sort((a, b) => b.book.progress.updatedAt - a.book.progress.updatedAt || a.title.localeCompare(b.title));
  }, [books, filter, q]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: books.length, unread: 0, reading: 0, done: 0 };
    for (const b of books) c[b.book.status]++;
    return c;
  }, [books]);

  const add = () => {
    try {
      localStorage.setItem(COURSE_KEY, targetCourse);
    } catch {
      /* private mode */
    }
    void startBookImport(targetCourse || null, navigate);
  };

  return (
    <div className="page page-wide library-page">
      <div className="kicker">Library</div>
      <h1 className="page-title">Books</h1>
      <p className="muted">
        {isLoading ? "Loading…" : `${plural(books.length, "book")} · ${counts.reading} reading · ${counts.done} finished`}
      </p>

      <div className="library-bar">
        <div className="library-filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`library-filter${filter === f.id ? " is-active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label} <span className="tabular">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <label className="library-search">
          <Search size={15} />
          <input value={q} placeholder="Title, author, course or tag" onChange={(e) => setQ(e.target.value)} />
        </label>
        <span className="library-add">
          <select className="select" value={targetCourse} onChange={(e) => setCourseId(e.target.value)} aria-label="Add to course">
            <option value="">No course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || "Untitled course"}
              </option>
            ))}
          </select>
          <button type="button" className="btn-primary" onClick={add}>
            <Plus size={15} strokeWidth={2.4} />
            <span>Add book</span>
          </button>
        </span>
      </div>

      <div className="library-grid">
        {shown.map((b, i) => (
          <BookCard key={b.id} item={b} delay={Math.min(i, 20) * 20} onOpen={() => navigate(`/m/${b.id}`)} />
        ))}
      </div>
      {!isLoading && !books.length && (
        <p className="muted empty-note">
          No books yet. <strong>Add book</strong> takes a PDF or an EPUB and keeps it as it is: no splitting into pages,
          however long it is.
        </p>
      )}
      {!isLoading && books.length > 0 && !shown.length && <p className="muted empty-note">Nothing matches.</p>}
    </div>
  );
}

function BookCard({ item, delay, onOpen }: { item: BookListItem; delay: number; onOpen: () => void }) {
  const b = item.book;
  const pct = Math.round(b.progress.fraction * 100);
  return (
    <button type="button" className="book-card" style={{ animationDelay: `${delay}ms` }} onClick={onOpen}>
      <span className="book-card-cover">
        {b.coverUrl ? (
          <img src={b.coverUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="book-card-placeholder">
            <BookOpen size={22} />
            <span>{item.title || "Untitled"}</span>
          </span>
        )}
        <span className={`book-card-status is-${b.status}`}>{BOOK_STATUS_LABEL[b.status]}</span>
      </span>
      <span className="book-card-title">{item.title || "Untitled"}</span>
      {b.meta.authors && <span className="book-card-authors">{b.meta.authors}</span>}
      <span className="book-card-meta">
        <span className="book-card-course">{item.courseId ? item.courseName || "Untitled course" : "No course"}</span>
        <span className="book-card-format">{b.file.format.toUpperCase()}</span>
      </span>
      <span className="book-progress book-card-progress">
        <span className="book-progress-bar">
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="tabular">{b.status === "done" ? "Finished" : bookProgressLabel(b)}</span>
        {b.highlights.length > 0 && (
          <span className="book-card-hl tabular" title={plural(b.highlights.length, "highlight")}>
            <Highlighter size={12} /> {b.highlights.length}
          </span>
        )}
      </span>
    </button>
  );
}
