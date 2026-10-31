import { fileIconUrl, folderIconUrl } from '@/config/fileIcons';

export function FileIcon({ name, size = 16 }) {
  return (
    <img
      src={fileIconUrl(name)}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      className="shrink-0"
    />
  );
}

export function FolderIcon({ name, open, size = 16 }) {
  return (
    <img
      src={folderIconUrl(name, open)}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      className="shrink-0"
    />
  );
}
