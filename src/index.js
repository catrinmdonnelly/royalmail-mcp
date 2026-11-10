#!/usr/bin/env node
/**
 * Royal Mail Click & Drop MCP Server
 *
 * Connects any MCP-compatible AI (Claude, Cursor, etc.) to Royal Mail's
 * Click & Drop API for booking, labelling, tracking and cancelling UK shipments.
 *
 * Usage: node src/index.js  (or: npx royalmail-mcp)
 * Config: copy .env.example to .env and add your RM_API_KEY
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as rm from './carriers/royalmail.js';
import { saveLabelToDisk, mergeLabelsTolerant, recordBooking, timestamp } from './utils/labels.js';
import { cleanText } from './utils/text.js';

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');

if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key && rest.length) {
      // Settings passed in by the MCP client win over this file.
      if (process.env[key.trim()] === undefined) {
        process.env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
      }
    }
  }
}

const server = new McpServer({
  name: 'royalmail-mcp',
  version: '0.2.1',
});

server.tool(
  'book_order',
  'Book a Royal Mail shipment via Click & Drop. Returns an orderIdentifier used to retrieve the label.',
  {
    service: z.string().describe('Royal Mail or Parcelforce service. Use a key from list_services, such as "first-class", "tracked-24", "tracked-48" or "special-delivery-1000", or a raw Service Register code such as OLP1 or TOLP24. Ask which service is wanted rather than guessing.'),

    packageFormat: z.enum([
      'letter',
      'large-letter',
      'small-parcel',
      'medium-parcel',
      'parcel',
    ]).default('small-parcel').describe('Package format. Determines which services are available and pricing'),

    weightGrams: z.number().positive().describe('Total weight in grams (e.g. 500 for 500g)'),

    recipient: z.object({
      fullName:     z.string().describe('Recipient full name'),
      companyName:  z.string().optional().describe('Company name (optional)'),
      addressLine1: z.string().describe('First line of address'),
      addressLine2: z.string().optional().describe('Second line of address (optional)'),
      city:         z.string().describe('Town or city'),
      county:       z.string().optional().describe('County (optional)'),
      postcode:     z.string().describe('UK postcode'),
      phone:        z.string().optional().describe('Phone number (optional)'),
      email:        z.string().optional().describe('Email for delivery notifications (optional)'),
    }).describe('Recipient / delivery address'),

    sender: z.object({
      fullName:     z.string().optional(),
      companyName:  z.string().optional(),
      addressLine1: z.string(),
      addressLine2: z.string().optional(),
      city:         z.string(),
      postcode:     z.string(),
    }).optional().describe('Sender address. Omit to use the address saved in your Click & Drop account'),

    reference:    z.string().optional().describe('Your internal order or job reference'),
    subtotal:     z.number().optional().describe('Order subtotal in GBP (used for customs/insurance)'),
    shippingCost: z.number().optional().describe('Shipping cost charged to recipient in GBP'),
    total:        z.number().optional().describe('Order total in GBP'),

    despatchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Planned despatch date YYYY-MM-DD. Omit if your account does not allow future-dated orders'),

    requireSignature: z.boolean().optional().describe('Request signature on delivery'),
    safePlace:        z.string().optional().describe('Safe place instructions e.g. "leave in porch"'),
    notifyEmail:      z.string().optional().describe('Email address for delivery notifications'),
    notifyPhone:      z.string().optional().describe('Mobile number for SMS delivery notifications'),

    dimensions: z.object({
      heightMm: z.number(),
      widthMm:  z.number(),
      depthMm:  z.number(),
    }).optional().describe('Package dimensions in mm (optional)'),

    goodsDescription: z.string().optional().describe('Brief description of contents'),
    specialInstructions: z.string().optional().describe('Special handling instructions'),
  },
  { title: 'Book a Royal Mail order', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async (params) => {
    try {
      const result = await rm.createOrder(params);
      await recordBooking({ carrier: 'Royal Mail', orderIdentifier: result.orderIdentifier, recipient: `${params.recipient.fullName}, ${params.recipient.postcode}`, reference: params.reference || null });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.success,
            carrier: 'Royal Mail',
            orderIdentifier: result.orderIdentifier,
            orderReference:  result.orderReference,
            status:          result.status,
            service:         result.service,
            serviceCode:     result.serviceCode,
            note: 'Use orderIdentifier with get_label to download the shipping label.',
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error booking Royal Mail order: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  'get_label',
  'Get the shipping label for a Royal Mail Click & Drop order and save it to disk. Works for any order you have previously booked, so pass its orderIdentifier. Needs a Royal Mail Online Business Account. Default save location is ~/Downloads/parcel-toolkit/, overridable via the PARCEL_TOOLKIT_LABELS_DIR env var.',
  {
    orderIdentifier: z.string().describe('The orderIdentifier returned when booking the order (or from a previously booked order).'),
  },
  { title: 'Get a Royal Mail label', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async ({ orderIdentifier }) => {
    try {
      const result = await rm.getLabel(orderIdentifier);
      const filePath = await saveLabelToDisk({
        labelBase64: result.labelBase64,
        filenameStem: `rm-${orderIdentifier}-${timestamp()}`,
        extension: 'pdf',
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            orderIdentifier,
            format: 'PDF',
            filePath,
            message: `Label saved to ${filePath}. Open or drag the file to print.`,
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error getting Royal Mail label: ${err.message}` }],
        isError: true,
      };
    }
  }
);

const rmRecipientSchema = z.object({
  fullName:     z.string().describe('Recipient full name'),
  companyName:  z.string().optional().describe('Company name (optional)'),
  addressLine1: z.string().describe('First line of address'),
  addressLine2: z.string().optional().describe('Second line of address (optional)'),
  city:         z.string().describe('Town or city'),
  county:       z.string().optional().describe('County (optional)'),
  postcode:     z.string().describe('UK postcode'),
  phone:        z.string().optional().describe('Phone number (optional)'),
  email:        z.string().optional().describe('Email for delivery notifications (optional)'),
});

const rmPerShipmentSchema = z.object({
  recipient: rmRecipientSchema.describe('Recipient address for this order'),
  weightGrams: z.number().positive().describe('Weight in grams for this order (e.g. 500 for 500g)'),
  reference: z.string().optional().describe('Internal order reference for this shipment'),
  subtotal: z.number().optional().describe('Order subtotal in GBP (used for customs/insurance)'),
  goodsDescription: z.string().optional().describe('Brief description of contents'),
});

server.tool(
  'book_batch_and_label',
  'Book multiple Royal Mail orders at once (up to 50), then fetch the labels and merge them into one PDF, ready to print. Every order booked costs money. Use this when the user pastes a list of orders/addresses. All orders share the same service, package format and sender. Saving labels through the API needs a Royal Mail Online Business Account. On other accounts the orders are still booked and reported, and the labels are printed from the Click & Drop website. An order that is booked but has no saved label is reported with its orderIdentifier, so never book it again. Saves to ~/Downloads/parcel-toolkit/ (overridable via PARCEL_TOOLKIT_LABELS_DIR).',
  {
    service: z.string().describe('Royal Mail service for every order in this batch (e.g. "tracked-24", "tracked-48", "first-class", "special-delivery-1000"). Call list_services for full catalogue.'),
    packageFormat: z.enum(['letter', 'large-letter', 'small-parcel', 'medium-parcel', 'parcel']).default('small-parcel').describe('Package format for every order in the batch.'),
    sender: z.object({
      fullName:     z.string().optional(),
      companyName:  z.string().optional(),
      addressLine1: z.string(),
      addressLine2: z.string().optional(),
      city:         z.string(),
      postcode:     z.string(),
    }).optional().describe('Sender address. Omit to use the address saved in your Click & Drop account.'),
    despatchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Planned despatch date YYYY-MM-DD. Omit if the account does not allow future-dated orders.'),
    shipments: z.array(rmPerShipmentSchema).min(1).max(50).describe('Array of orders to book, at most 50. Each entry is one order with its own recipient, weight and reference.'),
  },
  { title: 'Book several Royal Mail orders and print their labels', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async (params) => {
    const { service, packageFormat, sender, despatchDate, shipments } = params;

    // Step 1: book every order. Nothing after this may hide an order that has been created.
    const booked = [];
    const failures = [];

    for (let i = 0; i < shipments.length; i++) {
      const s = shipments[i];
      const recipient = `${s.recipient.fullName}, ${s.recipient.postcode}`;
      try {
        const result = await rm.createOrder({
          service,
          packageFormat,
          weightGrams: s.weightGrams,
          recipient: s.recipient,
          sender,
          despatchDate,
          reference: s.reference,
          subtotal: s.subtotal,
          goodsDescription: s.goodsDescription,
        });
        booked.push({
          index: i + 1,
          recipient,
          orderIdentifier: result.orderIdentifier,
          orderReference: result.orderReference,
          reference: s.reference || null,
        });
        await recordBooking({ carrier: 'Royal Mail', orderIdentifier: result.orderIdentifier, recipient, reference: s.reference || null });
      } catch (err) {
        failures.push({ index: i + 1, recipient, error: cleanText(err.message, 300) });
      }
    }

    if (booked.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            booked: 0,
            failed: failures.length,
            failures,
            message: 'Nothing was booked. See failures for details.',
          }, null, 2),
        }],
        isError: true,
      };
    }

    // Step 2: fetch the labels. A label that cannot be fetched leaves the order in place.
    const labels = [];
    let labelsNotAllowed = false;
    for (const entry of booked) {
      try {
        labels.push({ id: entry.orderIdentifier, labelBase64: (await rm.getLabel(entry.orderIdentifier)).labelBase64 });
      } catch (err) {
        entry.labelError = cleanText(err.message, 300);
        if (err.status === 403) labelsNotAllowed = true;
      }
    }

    // Step 3: merge them into one PDF.
    let mergedPdfPath;
    let mergeError;
    if (labels.length > 0) {
      try {
        const merge = await mergeLabelsTolerant({
          labels,
          filenameStem: `rm-batch-${timestamp()}-${labels.length}labels`,
        });
        mergedPdfPath = merge.path;
        for (const { id, error } of merge.skipped) {
          const entry = booked.find((b) => b.orderIdentifier === id);
          if (entry) entry.labelError = error;
        }
      } catch (err) {
        mergeError = cleanText(err.message, 300);
      }
    }

    const withoutLabel = booked.filter((b) => mergeError || b.labelError);
    const parts = [`Booked ${booked.length} of ${shipments.length} orders. Each booking is also written to bookings.jsonl in the labels folder.`];
    if (mergedPdfPath) parts.push(`Merged PDF saved to ${mergedPdfPath}.`);
    if (withoutLabel.length > 0) {
      parts.push(
        `${withoutLabel.length} booked order${withoutLabel.length === 1 ? ' has' : 's have'} no saved label. ` +
        `They are booked, so do not book them again.` +
        (labelsNotAllowed
          ? ' Saving labels through the API needs a Royal Mail Online Business Account, so print these from the Click & Drop website.'
          : ' Call get_label with each orderIdentifier to try again, or print them from the Click & Drop website.')
      );
    }
    if (failures.length > 0) {
      parts.push(`${failures.length} order${failures.length === 1 ? ' was' : 's were'} not booked. If an error says the order may still have been created, check Click & Drop before booking it again.`);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          carrier: 'Royal Mail',
          service,
          packageFormat,
          despatchDate: despatchDate || null,
          booked: booked.length,
          failed: failures.length,
          shipments: booked,
          failures: failures.length ? failures : undefined,
          mergedPdfPath,
          mergeError,
          message: parts.join(' '),
        }, null, 2),
      }],
    };
  }
);

server.tool(
  'track_order',
  'Get the current status and tracking details for a Royal Mail Click & Drop order.',
  {
    orderIdentifier: z.string().describe('The orderIdentifier returned when booking the order'),
  },
  { title: 'Track a Royal Mail order', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async ({ orderIdentifier }) => {
    try {
      const result = await rm.getOrder(orderIdentifier);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.success,
            orderIdentifier,
            status:         result.status,
            trackingNumber: result.trackingNumber,
            service:        result.service,
            despatchDate:   result.despatchDate,
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error tracking Royal Mail order: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  'cancel_order',
  'Cancel a Royal Mail Click & Drop order. Must be done before the order is manifested/despatched.',
  {
    orderIdentifier: z.string().describe('The orderIdentifier to cancel'),
  },
  { title: 'Cancel a Royal Mail order', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async ({ orderIdentifier }) => {
    try {
      const result = await rm.cancelOrder(orderIdentifier);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.success,
            orderIdentifier,
            message: result.message,
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error cancelling Royal Mail order: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  'list_services',
  'List supported Royal Mail and Parcelforce services with their Service Register codes. Availability depends on your Click & Drop account.',
  {},
  { title: 'List Royal Mail services', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async () => ({
    content: [{
      type: 'text',
      text: JSON.stringify({
        carrier: 'Royal Mail',
        services: [
          // 1st & 2nd Class
          { key: 'first-class',                  label: 'Royal Mail 1st Class',                       code: 'OLP1',     typical: '1-2 days' },
          { key: 'first-class-signed',           label: 'Royal Mail Signed For 1st Class',            code: 'OLP1SF',   typical: '1-2 days' },
          { key: 'second-class',                 label: 'Royal Mail 2nd Class',                       code: 'OLP2',     typical: '2-3 days' },
          { key: 'second-class-signed',          label: 'Royal Mail Signed For 2nd Class',            code: 'OLP2SF',   typical: '2-3 days' },
          // Tracked
          { key: 'tracked-24',                   label: 'Royal Mail Tracked 24',                      code: 'TOLP24',   typical: '1 day' },
          { key: 'tracked-24-signed',            label: 'Royal Mail Tracked 24 with Signature',       code: 'TOLP24SF', typical: '1 day' },
          { key: 'tracked-24-age',               label: 'Royal Mail Tracked 24 + Age Verification',   code: 'TOLP24SFA',typical: '1 day' },
          { key: 'tracked-48',                   label: 'Royal Mail Tracked 48',                      code: 'TOLP48',   typical: '2-3 days' },
          { key: 'tracked-48-signed',            label: 'Royal Mail Tracked 48 with Signature',       code: 'TOLP48SF', typical: '2-3 days' },
          { key: 'tracked-48-age',               label: 'Royal Mail Tracked 48 + Age Verification',   code: 'TOLP48SFA',typical: '2-3 days' },
          // Special Delivery (by 1pm)
          { key: 'special-delivery-750',         label: 'Special Delivery by 1pm: £750 compensation',   code: 'SD1OLP', typical: 'Next day, guaranteed' },
          { key: 'special-delivery-1000',        label: 'Special Delivery by 1pm: £1,000 compensation', code: 'SD2OLP', typical: 'Next day, guaranteed' },
          { key: 'special-delivery-2500',        label: 'Special Delivery by 1pm: £2,500 compensation', code: 'SD3OLP', typical: 'Next day, guaranteed' },
          // Parcelforce UK
          { key: 'parcelforce-10',               label: 'Parcelforce express10 (by 10am)',            code: 'PFE10',    typical: 'Next day by 10am' },
          { key: 'parcelforce-10-signed',        label: 'Parcelforce express10 + Signature',          code: 'PFE10SF',  typical: 'Next day by 10am' },
          { key: 'parcelforce-24',               label: 'Parcelforce express24',                      code: 'PFE24',    typical: 'Next day' },
          { key: 'parcelforce-24-signed',        label: 'Parcelforce express24 + Signature',          code: 'PFE24SF',  typical: 'Next day' },
          { key: 'parcelforce-48',               label: 'Parcelforce express48',                      code: 'PFE48',    typical: '2 days' },
          { key: 'parcelforce-48-signed',        label: 'Parcelforce express48 + Signature',          code: 'PFE48SF',  typical: '2 days' },
          { key: 'parcelforce-am',               label: 'Parcelforce expressAM (by noon)',            code: 'PFEAM',    typical: 'Next day by noon' },
          { key: 'parcelforce-am-signed',        label: 'Parcelforce expressAM + Signature',          code: 'PFEAMSF',  typical: 'Next day by noon' },
          { key: 'parcelforce-48-large',         label: 'Parcelforce express48 Large',                code: 'PFELG',    typical: '2 days' },
          { key: 'parcelforce-48-large-signed',  label: 'Parcelforce express48 Large + Signature',    code: 'PFELGSF',  typical: '2 days' },
          // Parcelforce International
          { key: 'parcelforce-ireland',          label: 'Parcelforce irelandexpress',                 code: 'PFIIX' },
          { key: 'parcelforce-global-express',   label: 'Parcelforce globalexpress',                  code: 'PFIGX' },
          { key: 'parcelforce-priority-europe',  label: 'Parcelforce globalpriority Europe',          code: 'PFIGPE' },
          { key: 'parcelforce-priority-row',     label: 'Parcelforce globalpriority Rest of World',   code: 'PFIGPG' },
          // Royal Mail International
          { key: 'international-economy',                label: 'International Economy',           code: 'IEOLP'   },
          { key: 'international-standard',               label: 'International Standard',          code: 'ISOLP'   },
          { key: 'international-tracked',                label: 'International Tracked',           code: 'ITROLP'  },
          { key: 'international-tracked-heavier',        label: 'International Tracked Heavier',   code: 'ITHOLP'  },
          { key: 'international-tracked-heavier-comp',   label: 'International Tracked Heavier (with compensation)', code: 'ITHCOLP' },
          { key: 'international-tracked-signed',         label: 'International Tracked & Signed',  code: 'ITSOLP'  },
        ],
        note: 'These services are for UK addresses. International services also need a destination country and customs details, which this tool does not take yet. Pass either the friendly key (e.g. "first-class") or the raw code (e.g. "OLP1") to book_order. Service availability depends on what your Click & Drop account has enabled.',
      }, null, 2),
    }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
