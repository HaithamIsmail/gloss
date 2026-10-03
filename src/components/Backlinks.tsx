import { useQuery } from "@tanstack/react-query";
import { CornerDownRight } from "lucide-react";
import { Link } from "react-router";
import { api, keys } from "../api";
import { KIND_ICON } from "../kinds";

/** The pages that link here with "@". */
export function Backlinks({ materialId, className = "" }: { materialId: string; className?: string }) {
  const { data } = useQuery({
    queryKey: keys.backlinks(materialId),
    queryFn: () => api.backlinks(materialId),
    staleTime: 0,
  });
  if (!data?.length) return null;
  return (
    <section className={`backlinks ${className}`}>
      <div className="backlinks-head label-caps">
        <CornerDownRight size={13} strokeWidth={2.4} /> Linked from {data.length}
      </div>
      {data.map((b) => {
        const Icon = KIND_ICON[b.kind];
        return (
          <Link key={b.materialId} to={`/m/${b.materialId}`} className="backlink">
            <Icon size={15} />
            <span className="backlink-title">{b.title || "Untitled"}</span>
            <span className="backlink-meta">
              {b.courseName}
              {b.count > 1 && ` · ${b.count} links`}
            </span>
          </Link>
        );
      })}
    </section>
  );
}
