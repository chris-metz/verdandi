/**
 * The elements Verdandi adds to the bodies it shows, rather than keeps from
 * GitHub's HTML: its own buttons, which an attribute marks to act on, the
 * images it loads, and placeholders where an image or video does not show.
 */

/** Marks the buttons that open what a body or comment shows on GitHub. */
export const openOnGitHubAttribute = "data-open-on-github";

/**
 * Marks the buttons that load an image from elsewhere than GitHub's media
 * hosts, with its address.
 */
export const loadImageAttribute = "data-load-image";

/** The description of the image a Load image button loads. */
export const imageAltAttribute = "data-image-alt";

/** Marks the buttons that load an image or video that failed again. */
export const retryMediaAttribute = "data-retry-media";

/** One of Verdandi's own buttons, marked by its attribute to act on. */
export interface OwnButton {
  label: string;
  attribute: string;
  value?: string;
  /** Another attribute it carries, for what it acts on. */
  data?: { attribute: string; value: string };
}

export function ownButton(
  { label, attribute, value = "", data }: OwnButton,
  document: Document,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(attribute, value);
  if (data) button.setAttribute(data.attribute, data.value);
  button.textContent = label;
  return button;
}

/**
 * An image Verdandi loads, which opens in the viewer unless it is in a link,
 * which a click follows instead.
 */
export function mediaImage(
  document: Document,
  { src, alt, inLink }: { src: string; alt: string; inLink: boolean },
): HTMLImageElement {
  const image = document.createElement("img");
  image.className = "media-image";
  image.setAttribute("src", src);
  image.setAttribute("alt", alt);
  if (!inLink) {
    image.setAttribute("tabindex", "0");
    image.setAttribute("role", "button");
  }
  return image;
}

/** An image or video named by its kind and description, e.g. `Image: Logo`. */
export function mediumName(kind: string, description: string): string {
  return description && description.toLowerCase() !== kind.toLowerCase()
    ? `${kind}: ${description}`
    : kind;
}

/**
 * Where an image or video would show, named, with why it does not, and
 * buttons to do something about it.
 */
export function mediaPlaceholder(
  document: Document,
  {
    name,
    reason,
    buttons,
  }: { name: string; reason: string; buttons: OwnButton[] },
): HTMLElement {
  const placeholder = document.createElement("span");
  placeholder.className = "media-placeholder";
  const title = document.createElement("span");
  title.className = "media-placeholder-name";
  title.textContent = name;
  const why = document.createElement("span");
  why.className = "media-placeholder-reason";
  why.textContent = reason;
  placeholder.append(
    title,
    why,
    ...buttons.map((button) => ownButton(button, document)),
  );
  return placeholder;
}

/**
 * The placeholder of an image from elsewhere than GitHub's media hosts,
 * which loads it once asked.
 */
export function thirdPartyPlaceholder(
  document: Document,
  { url, alt, reason }: { url: string; alt: string; reason: string },
): HTMLElement {
  return mediaPlaceholder(document, {
    name: mediumName("Image", alt),
    reason,
    buttons: [
      {
        label: "Load image",
        attribute: loadImageAttribute,
        value: url,
        data: { attribute: imageAltAttribute, value: alt },
      },
    ],
  });
}
