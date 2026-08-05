import * as cheerio from "cheerio";
import type { Document } from "../types.js";
import { asName, collectJsonLdNodes, findByType, firstString } from "./jsonld.js";
import { parseNumber as toNumber } from "../lib/coerce.js";

/**
 * Canonical product shape for any e-commerce page. Same layered strategy as the
 * article extractor — one code path, many stores — leaning on schema.org
 * `Product` JSON-LD (which most shops emit for Google Shopping / SEO), with
 * Open Graph product meta as fallback. No per-site rules.
 */
export interface Product {
  name: string | null;
  brand: string | null;
  price: number | null;
  currency: string | null;
  priceText: string | null;
  availability: string | null; // "InStock" | "OutOfStock" | ...
  rating: number | null;
  ratingCount: number | null;
  sku: string | null;
  image: string | null;
  description: string | null;
  url: string;
  sources: Record<string, "json-ld" | "meta" | "none">;
}

const PRODUCT_TYPES = new Set(["product", "productgroup", "individualproduct"]);

/** Offers may be Offer | AggregateOffer | array; pull the first with a price. */
function pickOffer(offers: unknown): Record<string, unknown> | null {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const o of list) {
    if (o && typeof o === "object") {
      const obj = o as Record<string, unknown>;
      if (obj.price ?? obj.lowPrice ?? obj.highPrice) return obj;
    }
  }
  return list[0] && typeof list[0] === "object" ? (list[0] as Record<string, unknown>) : null;
}

export function extractProduct(doc: Document): Product {
  const html = doc.rawHtml ?? doc.html ?? "";
  const $ = cheerio.load(html);
  const url = doc.metadata.url;
  const sources: Product["sources"] = {};

  const ld = collectJsonLdNodes($);
  const p = findByType(ld, PRODUCT_TYPES);
  const metaProp = (x: string) => $(`meta[property="${x}"]`).attr("content")?.trim() || undefined;

  const set = <T>(field: keyof Product, ldVal: T | null, metaVal?: string) => {
    if (ldVal !== null && ldVal !== undefined && ldVal !== "") {
      sources[field] = "json-ld";
      return ldVal;
    }
    if (metaVal) {
      sources[field] = "meta";
      return metaVal as unknown as T;
    }
    sources[field] = "none";
    return null;
  };

  const offer = p ? pickOffer(p.offers) : null;
  const rating = p && p.aggregateRating && typeof p.aggregateRating === "object"
    ? (p.aggregateRating as Record<string, unknown>)
    : null;

  const name = set<string>("name", p ? firstString(p.name) : null, metaProp("og:title"));
  const brand = set<string>("brand", p ? asName(p.brand) : null, metaProp("product:brand"));

  const priceRaw = offer ? (offer.price ?? offer.lowPrice ?? null) : null;
  const price = set<number>(
    "price",
    toNumber(priceRaw),
    metaProp("product:price:amount") ?? metaProp("og:price:amount"),
  );
  const currency = set<string>(
    "currency",
    offer ? firstString(offer.priceCurrency) : null,
    metaProp("product:price:currency") ?? metaProp("og:price:currency"),
  );

  const availabilityRaw = offer ? firstString(offer.availability) : null;
  const availability = set<string>(
    "availability",
    availabilityRaw ? availabilityRaw.replace(/^https?:\/\/schema\.org\//i, "") : null,
    metaProp("product:availability"),
  );

  const ratingVal = set<number>("rating", rating ? toNumber(rating.ratingValue) : null);
  const ratingCount = set<number>(
    "ratingCount",
    rating ? toNumber(rating.reviewCount ?? rating.ratingCount) : null,
  );

  const sku = set<string>("sku", p ? firstString(p.sku) : null);
  const image = set<string>("image", p ? firstString(p.image) : null, metaProp("og:image"));
  const description = set<string>(
    "description",
    p ? firstString(p.description) : null,
    metaProp("og:description"),
  );

  return {
    name,
    brand,
    price,
    currency,
    priceText:
      price !== null ? `${currency ? currency + " " : ""}${price.toLocaleString("id-ID")}` : null,
    availability,
    rating: ratingVal,
    ratingCount,
    sku,
    image,
    description,
    url,
    sources,
  };
}
