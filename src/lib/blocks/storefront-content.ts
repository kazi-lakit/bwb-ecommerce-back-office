import { blocksClient } from "./client";
import { blocksDataCall } from "./http";

// The schema is part of the live Cartio data model. Keep an explicit false escape hatch
// for maintenance, but never turn the editor into a setup-only screen merely because a
// deployment omitted the optional flag.
export const STOREFRONT_CONTENT_LIVE = import.meta.env.VITE_STOREFRONT_CONTENT_LIVE !== "false";
export const HOME_HERO_KEY = "home-primary";

export interface StorefrontHeroContent {
  ItemId?: string;
  PlacementKey: string;
  Status: "draft" | "published";
  Eyebrow: string;
  Heading: string;
  Description: string;
  PrimaryCtaLabel: string;
  PrimaryCtaHref: string;
  SecondaryCtaLabel: string;
  SecondaryCtaHref: string;
  ImageUrl: string;
  ImageFileId: string;
  ImageAltText: string;
  HighlightOne: string;
  HighlightTwo: string;
  HighlightThree: string;
}

export const DEFAULT_STOREFRONT_HERO: StorefrontHeroContent = {
  PlacementKey: HOME_HERO_KEY,
  Status: "published",
  Eyebrow: `Autumn collection · ${new Date().getFullYear()}`,
  Heading: "Considered pieces for modern living.",
  Description: "Furniture and objects selected for enduring quality, thoughtful function, and a home that feels distinctly yours.",
  PrimaryCtaLabel: "Shop the collection",
  PrimaryCtaHref: "/products",
  SecondaryCtaLabel: "Explore all pieces",
  SecondaryCtaHref: "/products",
  ImageUrl: "",
  ImageFileId: "",
  ImageAltText: "A warm contemporary living room with sculptural furniture and natural textures",
  HighlightOne: "Curated collections",
  HighlightTwo: "Secure account",
  HighlightThree: "Thoughtful delivery",
};

const HERO_FIELDS = `
  ItemId PlacementKey Status Eyebrow Heading Description
  PrimaryCtaLabel PrimaryCtaHref SecondaryCtaLabel SecondaryCtaHref
  ImageUrl ImageFileId ImageAltText HighlightOne HighlightTwo HighlightThree
`;

const GET_HOME_HERO = `query getStorefrontHeros($where: StorefrontHeroFilterInput) {
  getStorefrontHeros(where: $where, paging: { pageNo: 1, pageSize: 1 }) {
    items { ${HERO_FIELDS} }
  }
}`;

const INSERT_HOME_HERO = `mutation insertStorefrontHero($input: StorefrontHeroInsertInput!) {
  insertStorefrontHero(input: $input) { acknowledged itemId message totalImpactedData }
}`;

const UPDATE_HOME_HERO = `mutation updateStorefrontHero($where: StorefrontHeroFilterInput, $input: StorefrontHeroUpdateInput!) {
  updateStorefrontHero(where: $where, input: $input) { acknowledged itemId message totalImpactedData }
}`;

function dataObject(response: unknown): Record<string, unknown> | undefined {
  const root = response as Record<string, unknown> | undefined;
  return (root?.data ?? root) as Record<string, unknown> | undefined;
}

export async function getHomeHero(): Promise<StorefrontHeroContent | null> {
  if (!STOREFRONT_CONTENT_LIVE) return null;
  const response = await blocksDataCall(() =>
    blocksClient.data.graphql({
      operationName: "getStorefrontHeros",
      query: GET_HOME_HERO,
      variables: { where: { PlacementKey: { eq: HOME_HERO_KEY } } },
    })
  );
  const result = dataObject(response)?.getStorefrontHeros as { items?: StorefrontHeroContent[] } | undefined;
  return result?.items?.[0] ?? null;
}

export async function saveHomeHero(content: StorefrontHeroContent): Promise<void> {
  if (!STOREFRONT_CONTENT_LIVE) throw new Error("Storefront content management is not enabled yet.");

  const { ItemId, ...payload } = content;
  const operationName = ItemId ? "updateStorefrontHero" : "insertStorefrontHero";
  const response = await blocksDataCall(() =>
    blocksClient.data.graphql({
      operationName,
      query: ItemId ? UPDATE_HOME_HERO : INSERT_HOME_HERO,
      variables: ItemId ? { where: { ItemId: { eq: ItemId } }, input: payload } : { input: payload },
    })
  );
  const result = dataObject(response)?.[operationName] as { acknowledged?: boolean; itemId?: string; totalImpactedData?: number; message?: string } | undefined;
  if (!result?.acknowledged || (ItemId && result.totalImpactedData === 0)) {
    throw new Error(result?.message || "The hero content could not be saved.");
  }
}
