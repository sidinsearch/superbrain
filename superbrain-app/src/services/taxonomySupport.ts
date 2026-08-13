/**
 * Helpers for optional server-driven category taxonomy (`GET /taxonomy`).
 *
 * When the endpoint is absent (upstream mainline today), clients must keep
 * historical APK behavior. New chip/sync rules activate only when the server
 * returns a successful taxonomy payload with at least one category.
 */

export type TaxonomyPayload = {
  categories: Array<{ id: string; name: string; precedence?: number; guidance?: string }>;
  allow_multiple_categories: boolean;
  fallback_category: string;
  use_default_categories: boolean;
  taxonomy_version: string;
};

/** True when the backend exposes a usable config-driven taxonomy. */
export function isTaxonomyApiActive(
  taxonomy: TaxonomyPayload | null | undefined
): boolean {
  return !!(taxonomy && Array.isArray(taxonomy.categories) && taxonomy.categories.length > 0);
}

/**
 * Strict custom taxonomy: hide built-in product/places/food chips and any
 * labels outside the configured list. Only when the server explicitly sets
 * use_default_categories=false.
 */
export function usesStrictCustomTaxonomy(
  taxonomy: TaxonomyPayload | null | undefined
): boolean {
  return isTaxonomyApiActive(taxonomy) && taxonomy!.use_default_categories === false;
}
