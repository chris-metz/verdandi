import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/** An image a body shows, as the viewer shows it. */
export interface ViewedImage {
  src: string;
  alt: string;
}

/**
 * An image at its full size, in the window, scrolling where it is larger:
 * Esc, Close or a click beside it closes it, and the keyboard goes back
 * where it was. Keys pressed meanwhile stay with it, rather than moving the
 * page beneath.
 */
export function ImageViewer({
  image,
  onClose,
}: {
  image: ViewedImage | undefined;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={image !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {image && (
        <DialogContent
          className="block max-h-[calc(100%-4rem)] w-max max-w-[calc(100%-4rem)] overflow-auto bg-background p-0 sm:max-w-[calc(100%-4rem)]"
          onKeyDown={(event) => {
            event.stopPropagation();
          }}
        >
          <DialogTitle className="sr-only">{image.alt || "Image"}</DialogTitle>
          <FullSizeImage key={image.src} image={image} />
        </DialogContent>
      )}
    </Dialog>
  );
}

/** The image itself, or why it could not be shown. */
function FullSizeImage({ image }: { image: ViewedImage }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <p className="px-12 py-8 text-muted-foreground">
        The image could not be loaded.
      </p>
    );
  }
  return (
    <img
      src={image.src}
      alt={image.alt}
      referrerPolicy="no-referrer"
      className="block max-w-none"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}
