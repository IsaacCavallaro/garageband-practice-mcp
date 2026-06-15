const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug || "untitled-song";
}

export function assertValidSlug(slug: string): string {
  if (!slugPattern.test(slug)) {
    throw new Error("Project slug must contain lowercase letters, numbers, and single hyphens only.");
  }

  return slug;
}

export function safeFileStem(input: string): string {
  return slugify(input).slice(0, 120);
}
