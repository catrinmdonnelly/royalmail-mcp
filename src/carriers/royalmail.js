/**
 * Royal Mail Click & Drop API v1 client
 *
 * Base URL:  https://api.parcel.royalmail.com/api/v1
 * Docs:      https://developer.royalmail.net/click-and-drop
 * Auth:      Authorization: Bearer {api_key}
 *            Get your API key from: Click & Drop > Settings > API credentials
 *
 * Note: This API creates orders in Click & Drop, which then generates labels.
 *       Labels are returned as PDF binary. Base64-encoded in this client.
 */

import { cleanText, safeDigits, parseDate } from '../utils/text.js';

const DEFAULT_BASE_URL = 'https://api.parcel.royalmail.com/api/v1';
const REQUEST_TIMEOUT_MS = 30000;
const MAYBE_CREATED = ' The order may still have been created, so check Click & Drop before booking again.';

// Read on every call. The API key is only ever sent over https, or to a server on this computer.
function baseUrl() {
  const url = (process.env.RM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('RM_BASE_URL is not a valid web address.');
  }
  const onThisComputer = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && onThisComputer)) {
    throw new Error('RM_BASE_URL must start with https:// (plain http is only allowed for localhost).');
  }
  return url;
}

// ─── Service codes ────────────────────────────────────────────────────────────
// These are the Service Register codes as they appear in Click & Drop
// (Settings → Shipping services). Raw codes are also accepted: pass either a
// friendly key below OR the bare code (e.g. 'OLP1') to createOrder.
export const RM_SERVICES = {
  // ─── Royal Mail UK: 1st & 2nd Class ────────────────────────────────────────
  'first-class':              'OLP1',
  'first-class-signed':       'OLP1SF',
  'second-class':             'OLP2',
  'second-class-signed':      'OLP2SF',

  // ─── Royal Mail UK: Tracked ───────────────────────────────────────────────
  'tracked-24':               'TOLP24',
  'tracked-24-signed':        'TOLP24SF',
  'tracked-24-age':           'TOLP24SFA',
  'tracked-48':               'TOLP48',
  'tracked-48-signed':        'TOLP48SF',
  'tracked-48-age':           'TOLP48SFA',

  // ─── Royal Mail UK: Special Delivery by 1pm ───────────────────────────────
  // Compensation tier is encoded in the service code itself.
  'special-delivery-750':     'SD1OLP',
  'special-delivery-1000':    'SD2OLP',
  'special-delivery-2500':    'SD3OLP',

  // ─── Parcelforce UK express ────────────────────────────────────────────────
  // Compensation tiers (Comp 1/2/3) are selected at booking via declared value.
  'parcelforce-10':              'PFE10',
  'parcelforce-10-signed':       'PFE10SF',
  'parcelforce-24':              'PFE24',
  'parcelforce-24-signed':       'PFE24SF',
  'parcelforce-48':              'PFE48',
  'parcelforce-48-signed':       'PFE48SF',
  'parcelforce-am':              'PFEAM',
  'parcelforce-am-signed':       'PFEAMSF',
  'parcelforce-48-large':        'PFELG',
  'parcelforce-48-large-signed': 'PFELGSF',

  // ─── Parcelforce International ─────────────────────────────────────────────
  'parcelforce-ireland':         'PFIIX',
  'parcelforce-global-express':  'PFIGX',
  'parcelforce-priority-europe': 'PFIGPE',
  'parcelforce-priority-row':    'PFIGPG',

  // ─── Royal Mail International ──────────────────────────────────────────────
  'international-economy':              'IEOLP',
  'international-standard':             'ISOLP',
  'international-tracked':              'ITROLP',
  'international-tracked-heavier':      'ITHOLP',
  'international-tracked-heavier-comp': 'ITHCOLP',
  'international-tracked-signed':       'ITSOLP',
};

// Package format identifiers (Royal Mail terminology)
export const RM_PACKAGE_FORMATS = {
  'letter':        'letter',
  'large-letter':  'largeLetter',
  'small-parcel':  'smallParcel',
  'medium-parcel': 'mediumParcel',
  'parcel':        'parcel',
};

// ─── Auth helper ──────────────────────────────────────────────────────────────

function getAuthHeader() {
  const apiKey = process.env.RM_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Royal Mail API key not set. Add RM_API_KEY to the MCP server settings, or to a .env file if you run it by hand. ' +
      'Get yours from: Click & Drop > Settings > API credentials.'
    );
  }
  return `Bearer ${apiKey}`;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function request(method, path, body = null, { binary = false } = {}) {
  const url = `${baseUrl()}${path}`;

  const headers = {
    'Authorization': getAuthHeader(),
    'Content-Type':  'application/json',
    'Accept':        binary ? 'application/pdf' : 'application/json',
  };

  // The API key travels in a header, so never follow a redirect to another address.
  const options = { method, headers, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
  if (body) options.body = JSON.stringify(body);

  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      throw new Error(`Royal Mail did not reply within ${REQUEST_TIMEOUT_MS / 1000} seconds.${method === 'POST' ? MAYBE_CREATED : ''}`);
    }
    throw new Error(`Could not reach Royal Mail (${cleanText(err?.cause?.code || err?.message, 100)}).${method === 'POST' ? MAYBE_CREATED : ''}`);
  }

  if (!response.ok) {
    const error = await response.text().catch(() => '');
    const failure = new Error(`Royal Mail API ${response.status}: ${cleanText(error, 300)}${method === 'POST' && response.status >= 500 ? MAYBE_CREATED : ''}`);
    failure.status = response.status;
    throw failure;
  }

  if (binary) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.subarray(0, 5).toString() !== '%PDF-') {
      throw new Error('Royal Mail did not send a PDF label.');
    }
    return buffer.toString('base64');
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`Royal Mail sent a reply that could not be read.${method === 'POST' ? MAYBE_CREATED : ''}`);
  }
}

// ─── Create order ─────────────────────────────────────────────────────────────

/**
 * Create an order in Royal Mail Click & Drop
 *
 * @param {Object} params
 * @param {string} params.service              - Key from RM_SERVICES, or raw serviceCode
 * @param {string} params.packageFormat        - Key from RM_PACKAGE_FORMATS (default 'small-parcel')
 * @param {number} params.weightGrams          - Weight in grams
 * @param {Object} params.recipient            - { fullName, companyName?, addressLine1, addressLine2?, city, county?, postcode, countryCode?, phone?, email? }
 * @param {Object} params.sender               - { fullName?, companyName?, addressLine1, addressLine2?, city, county?, postcode, countryCode? }
 * @param {string} params.reference            - Your internal order reference
 * @param {number} params.subtotal             - Order subtotal in GBP
 * @param {number} params.shippingCost         - Shipping cost charged to customer in GBP
 * @param {number} params.total                - Order total in GBP
 * @param {string} params.despatchDate         - Planned despatch date YYYY-MM-DD (default: today)
 * @param {boolean} params.requireSignature    - Request signature on delivery
 * @param {string} params.safePlace            - Safe place instructions for unattended delivery
 * @param {string} params.notifyEmail          - Email for delivery notifications
 * @param {string} params.notifyPhone          - Phone/SMS for delivery notifications
 * @param {Object} params.dimensions           - { heightMm, widthMm, depthMm }
 * @param {string} params.goodsDescription     - Description of contents
 */
export async function createOrder(params) {
  const serviceCode = (Object.hasOwn(RM_SERVICES, params.service) ? RM_SERVICES[params.service] : params.service) || 'OLP1';
  const packageFormat = (Object.hasOwn(RM_PACKAGE_FORMATS, params.packageFormat) ? RM_PACKAGE_FORMATS[params.packageFormat] : params.packageFormat) || 'smallParcel';

  const orderDate = new Date().toISOString();
  let despatchDate = null;
  if (params.despatchDate) {
    const { y, m, d } = parseDate(params.despatchDate, 'The despatch date');
    despatchDate = new Date(Date.UTC(+y, +m - 1, +d)).toISOString();
  }

  // Build recipient: fullName and companyName live inside the address object
  const recipientAddress = {
    addressLine1: params.recipient.addressLine1,
    city:         params.recipient.city,
    postTown:     params.recipient.city,
    countryCode:  params.recipient.countryCode || 'GB',
  };
  if (params.recipient.fullName)     recipientAddress.fullName     = params.recipient.fullName;
  if (params.recipient.companyName)  recipientAddress.companyName  = params.recipient.companyName;
  if (params.recipient.addressLine2) recipientAddress.addressLine2 = params.recipient.addressLine2;
  if (params.recipient.postcode)     recipientAddress.postcode     = params.recipient.postcode;
  if (params.recipient.county)       recipientAddress.county       = params.recipient.county;
  if (params.recipient.phone)        recipientAddress.phoneNumber  = params.recipient.phone;
  if (params.recipient.email)        recipientAddress.emailAddress = params.recipient.email;

  const recipient = { address: recipientAddress };

  // Billing address is required by the API unless AddressBookReference is used.
  // Default to the recipient address if the caller didn't supply a separate billing block.
  const billingSource = params.billing || params.recipient;
  const billingAddress = {
    addressLine1: billingSource.addressLine1,
    city:         billingSource.city,
    postTown:     billingSource.city,
    countryCode:  billingSource.countryCode || 'GB',
  };
  if (billingSource.fullName)     billingAddress.fullName     = billingSource.fullName;
  if (billingSource.companyName)  billingAddress.companyName  = billingSource.companyName;
  if (billingSource.addressLine2) billingAddress.addressLine2 = billingSource.addressLine2;
  if (billingSource.postcode)     billingAddress.postcode     = billingSource.postcode;
  if (billingSource.county)       billingAddress.county       = billingSource.county;
  if (billingSource.phone)        billingAddress.phoneNumber  = billingSource.phone;
  if (billingSource.email)        billingAddress.emailAddress = billingSource.email;

  const billing = { address: billingAddress };

  // Build sender address (optional: falls back to account address if omitted)
  let sender;
  if (params.sender) {
    const senderAddress = {
      addressLine1: params.sender.addressLine1,
      city:         params.sender.city,
      countryCode:  params.sender.countryCode || 'GB',
    };
    if (params.sender.fullName)     senderAddress.fullName     = params.sender.fullName;
    if (params.sender.companyName)  senderAddress.companyName  = params.sender.companyName;
    if (params.sender.addressLine2) senderAddress.addressLine2 = params.sender.addressLine2;
    if (params.sender.postcode)     senderAddress.postcode     = params.sender.postcode;
    if (params.sender.county)       senderAddress.county       = params.sender.county;

    sender = { address: senderAddress };
  }

  // Build package
  const pkg = {
    weightInGrams:           Math.max(1, Math.round(params.weightGrams || 500)),
    packageFormatIdentifier: packageFormat,
  };
  if (params.dimensions) {
    pkg.dimensions = {
      heightInMms: params.dimensions.heightMm,
      widthInMms:  params.dimensions.widthMm,
      depthInMms:  params.dimensions.depthMm,
    };
  }
  if (params.goodsDescription) {
    pkg.contents = [{
      name: params.goodsDescription,
      quantity: 1,
      unitValue: params.subtotal || 0,
      unitWeightInGrams: pkg.weightInGrams,
    }];
  }

  // Build postage details
  const postageDetails = { serviceCode };
  if (params.requireSignature) postageDetails.requestSignatureUponDelivery = true;
  if (params.safePlace)        postageDetails.safePlace = params.safePlace;

  // Notifications
  if (params.notifyEmail || params.notifyPhone) {
    postageDetails.sendNotificationsTo = {};
    if (params.notifyEmail) postageDetails.sendNotificationsTo.emailAddress = params.notifyEmail;
    if (params.notifyPhone) postageDetails.sendNotificationsTo.mobileNumber = params.notifyPhone;
  }

  // Build the order request
  const orderRequest = {
    recipient,
    orderDate,
    subtotal:           params.subtotal         ?? 0,
    shippingCostCharged: params.shippingCost    ?? 0,
    total:              params.total             ?? 0,
    packages:           [pkg],
    postageDetails,
  };
  if (despatchDate) orderRequest.plannedDespatchDate = despatchDate;

  if (params.reference) orderRequest.orderReference = params.reference;
  if (sender)           orderRequest.sender = sender;
  if (params.specialInstructions) orderRequest.specialInstructions = params.specialInstructions;

  orderRequest.billing = billing;

  const body = { items: [orderRequest] };
  const result = await request('POST', '/orders', body);

  // Response shape: { successCount, errorsCount, createdOrders: [...], failedOrders: [...] }
  if (result.errorsCount > 0 && result.successCount === 0) {
    const err = result.failedOrders?.[0]?.errors?.[0];
    throw new Error(`Royal Mail order failed: ${cleanText(err?.errorMessage || JSON.stringify(result.failedOrders), 300)}`);
  }

  const created = result.createdOrders?.[0];
  if (created?.orderIdentifier === undefined || created?.orderIdentifier === null) {
    throw new Error('Royal Mail did not return an order identifier, so the order may not have been created. Check Click & Drop before booking again.');
  }

  return {
    success:         true,
    orderIdentifier: cleanText(String(created.orderIdentifier), 40),
    orderReference:  cleanText(created.orderReference || params.reference || '', 100),
    status:          cleanText(created.status || '', 60),
    service:         params.service,
    serviceCode,
  };
}

// ─── Get label ────────────────────────────────────────────────────────────────

/**
 * Get the shipping label for an order (PDF binary, base64-encoded)
 *
 * @param {string} orderIdentifier - The orderIdentifier returned when creating the order
 * @returns {{ success, orderIdentifier, labelBase64, format }}
 */
export async function getLabel(orderIdentifier) {
  // Returns PDF binary. documentType + includeReturnsLabel are both required query params.
  const id = safeDigits(orderIdentifier, 'The order identifier');
  const path = `/orders/${encodeURIComponent(id)}/label?documentType=postageLabel&includeReturnsLabel=false`;
  const labelBase64 = await request('GET', path, null, { binary: true });

  return {
    success: true,
    orderIdentifier: id,
    format: 'PDF',
    labelBase64,
  };
}

// ─── Get order ────────────────────────────────────────────────────────────────

/**
 * Get the current status and details of an order
 *
 * @param {string} orderIdentifier - The orderIdentifier returned when creating the order
 */
export async function getOrder(orderIdentifier) {
  const id = safeDigits(orderIdentifier, 'The order identifier');
  const result = await request('GET', `/orders/${encodeURIComponent(id)}`);
  const order = Array.isArray(result) ? result[0] : result;
  if (!order) throw new Error('Royal Mail has no order with that identifier.');

  return {
    success: true,
    orderIdentifier: id,
    status:         cleanText(order?.status, 120),
    trackingNumber: cleanText(order?.trackingNumber, 60),
    service:        cleanText(order?.postageDetails?.serviceCode, 40),
    despatchDate:   cleanText(order?.plannedDespatchDate, 40),
  };
}

// ─── Cancel order ─────────────────────────────────────────────────────────────

/**
 * Cancel an order. Only possible before it has been manifested/despatched
 *
 * @param {string} orderIdentifier
 */
export async function cancelOrder(orderIdentifier) {
  // Click & Drop cancels pre-despatch orders via DELETE.
  const id = safeDigits(orderIdentifier, 'The order identifier');
  const result = await request('DELETE', `/orders/${encodeURIComponent(id)}`);

  // Royal Mail answers 200 even when it refuses, and lists the reasons in `errors`.
  const refusals = Array.isArray(result?.errors) ? result.errors : [];
  const deleted = Array.isArray(result?.deletedOrders) ? result.deletedOrders : [];
  if (refusals.length > 0) {
    const reasons = refusals.slice(0, 3).map((e) => cleanText(e?.message || e?.code || 'refused', 150)).join('; ');
    return { success: false, orderIdentifier: id, message: `Royal Mail did not cancel the order: ${reasons}` };
  }
  if (deleted.length === 0) {
    return { success: false, orderIdentifier: id, message: 'Royal Mail did not confirm the cancellation. Check the order in Click & Drop.' };
  }
  return { success: true, orderIdentifier: id, message: 'Order cancelled.' };
}
