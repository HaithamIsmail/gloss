// Materials arrive as one flat list per course; folders (imported slides)
// group some of them through parentId.
import type { Course, MaterialSummary, Tree } from "../shared/api";

const byPosition = (a: MaterialSummary, b: MaterialSummary) => a.position - b.position;

/** Materials directly in the course (folders included, their pages not). */
export const topLevel = (course: Course) => course.materials.filter((m) => !m.parentId).sort(byPosition);

export const childrenOf = (course: Course, folderId: string) =>
  course.materials.filter((m) => m.parentId === folderId).sort(byPosition);

export function findMaterial(tree: Tree | undefined, id: string | undefined) {
  if (!tree || !id) return {};
  for (const course of tree.courses) {
    const material = course.materials.find((m) => m.id === id);
    if (material) {
      const folder = material.parentId ? course.materials.find((m) => m.id === material.parentId) : undefined;
      return { course, material, folder };
    }
  }
  return {};
}
