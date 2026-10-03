import { FileText, Folder, Image as ImageIcon, NotebookPen } from "lucide-react";
import type { MaterialKind } from "../shared/pages";

export const KIND_ICON: Record<MaterialKind, typeof FileText> = {
  doc: FileText,
  image: ImageIcon,
  notebook: NotebookPen,
  folder: Folder,
};

export const KIND_LABEL: Record<MaterialKind, string> = {
  doc: "Page",
  image: "Annotated image",
  notebook: "Notebook",
  folder: "Folder",
};
