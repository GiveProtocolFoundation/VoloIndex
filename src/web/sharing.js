/**
 * Volo Index — LinkedIn sharing utilities (T2-E)
 *
 * Pure ESM module, no Node.js-specific imports.
 * Importable by:
 *   - T2-D server code:    import { buildLinkedInAddToProfile } from './src/web/sharing.js'
 *   - credential.html:     <script type="module"> import ...
 *
 * No LinkedIn API or partner program required.
 * See docs/STOCK-TAKE-2026-07-12-launch-readiness.md §3 for design notes.
 */

const ORG_NAME = 'Give Protocol Foundation';

/**
 * Build the LinkedIn "Add to Profile" prefill URL.
 * Uses the Licenses & Certifications form deep link — no LinkedIn API required.
 * Works immediately; `organizationId` variant (shows GPF logo) needs a LinkedIn
 * Company Page — add organizationId param once the page is created.
 *
 * @param {object} opts
 * @param {string} opts.tier           - e.g. "Proficient"
 * @param {string} opts.certId         - UUID (used as certificationId)
 * @param {string} opts.certUrl        - public credential URL, e.g. https://voloindex.org/credential/abc
 * @param {string} opts.issueDate      - ISO date string, e.g. "2026-07-12"
 * @param {string} [opts.organizationName] - defaults to "Give Protocol Foundation"
 * @param {string} [opts.organizationId]   - LinkedIn Company Page numeric ID (optional)
 * @returns {string} LinkedIn Add-to-Profile URL
 */
export function buildLinkedInAddToProfile({
  tier,
  certId,
  certUrl,
  issueDate,
  organizationName = ORG_NAME,
  organizationId,
}) {
  const date = new Date(issueDate);
  const params = new URLSearchParams({
    startTask:        'CERTIFICATION_NAME',
    name:             `Volo Index — ${tier} Certificate`,
    organizationName,
    issueYear:        String(date.getFullYear()),
    issueMonth:       String(date.getMonth() + 1),
    certUrl,
    certId,
  });
  if (organizationId) {
    params.set('organizationId', String(organizationId));
  }
  return `https://www.linkedin.com/profile/add?${params}`;
}

/**
 * Build the LinkedIn "share as post" URL (share-offsite pattern).
 * The credential page at credentialUrl must serve OG meta tags for a rich card.
 * LinkedIn's crawler will fetch og:title, og:description, og:image from that URL.
 *
 * @param {string} credentialUrl - e.g. "https://voloindex.org/credential/abc"
 * @returns {string} LinkedIn share URL
 */
export function buildLinkedInShareUrl(credentialUrl) {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(credentialUrl)}`;
}

/**
 * Return the og:image URL for a given tier.
 * These are the static 1200×627 SVG cards in web/badges/.
 *
 * NOTE: For maximum LinkedIn compatibility, T2-D should serve these as PNGs
 * (or add a server route that rasterizes the SVG). SVG og:image works in most
 * crawlers but LinkedIn recommends PNG/JPG.
 *
 * @param {string} baseUrl - e.g. "https://voloindex.org"
 * @param {string} tier    - e.g. "Proficient" or "proficient"
 * @returns {string} absolute URL to the OG card image
 */
export function ogImageUrl(baseUrl, tier) {
  return `${baseUrl.replace(/\/$/, '')}/badges/og-${tier.toLowerCase()}.svg`;
}

/**
 * Build Open Graph + Twitter Card meta values for a credential page.
 * Returns a flat object of { property: content } pairs.
 * T2-D should inject these as <meta> tags server-side for crawler visibility.
 *
 * @param {object} opts
 * @param {string} opts.holderName  - certificate holder's display name
 * @param {string} opts.tier        - e.g. "Proficient"
 * @param {string} opts.certUrl     - canonical public credential URL
 * @param {string} opts.baseUrl     - site root URL for resolving asset paths
 * @returns {Record<string, string>}
 */
export function buildOGMeta({ holderName, tier, certUrl, baseUrl }) {
  const title       = `${holderName} earned a ${tier} Certificate | Volo Index`;
  const description = `${holderName} achieved the ${tier} tier in the Volunteer Leadership Assessment by Give Protocol Foundation.`;
  const image       = ogImageUrl(baseUrl, tier);

  return {
    'og:type':            'website',
    'og:title':           title,
    'og:description':     description,
    'og:url':             certUrl,
    'og:image':           image,
    'og:image:width':     '1200',
    'og:image:height':    '627',
    'og:site_name':       'Volo Index',
    'twitter:card':       'summary_large_image',
    'twitter:title':      title,
    'twitter:description': description,
    'twitter:image':      image,
  };
}
