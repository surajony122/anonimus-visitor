import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

export const EventPayloadSchema = z.object({
  visitor_id: z.string().min(1, 'visitor_id is required'),
  session_id: z.string().optional(),
  event_type: z.enum([
    'page_viewed',
    'product_viewed',
    'collection_viewed',
    'search_submitted',
    'cart_viewed',
    'product_added_to_cart',
    'checkout_started',
    'checkout_completed',
    'custom',
  ]),
  timestamp: z.string().optional(),
  page_url: z.string().optional(),
  product_id: z.string().optional(),
  variant_id: z.string().optional(),
  collection_id: z.string().optional(),
  cart_id: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export const BatchEventPayloadSchema = z.object({
  events: z.array(EventPayloadSchema).min(1).max(50),
});

export const IdentifyPayloadSchema = z.object({
  visitor_id: z.string().min(1, 'visitor_id is required'),
  type: z.enum(['email', 'phone', 'shopify_customer', 'google_account', 'merchant_identifier']),
  value: z.string().min(1, 'value is required'),
  source: z.enum(['user_submitted', 'checkout', 'shopify_customer', 'google_oauth', 'merchant_confirmed']).default('user_submitted'),
  confidence_score: z.number().min(0).max(100).optional(),
  metadata: z.record(z.any()).optional(),
});

export function validateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: result.error.errors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
