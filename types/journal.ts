export type ElementType = 'text' | 'image' | 'flower' | 'tape' | 'shape';

export interface ElementTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface PageElement {
  id: string;
  pageId: string;
  type: ElementType;
  content: Record<string, any>;
  transform: ElementTransform;
  zIndex: number;
  opacity: number;
  locked: boolean;
}

export interface JournalPage {
  id: string;
  journalId: string;
  pageNumber: number;
  title?: string;
  background: string;
  width: number;
  height: number;
}

export interface Journal {
  id: string;
  ownerId: string;
  title: string;
  description?: string;
  coverConfig: Record<string, any>;
  themeConfig: Record<string, any>;
  visibility: 'private' | 'link' | 'password' | 'shared';
  createdAt: string;
  updatedAt: string;
}
