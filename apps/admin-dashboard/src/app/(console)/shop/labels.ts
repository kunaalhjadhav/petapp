/** Parcel (sub-order) statuses as staff see them. */
export const PARCEL: Record<
  string,
  { label: string; tone: 'neutral' | 'good' | 'warn' | 'danger' | 'teal' }
> = {
  CONFIRMED: { label: 'To pack', tone: 'warn' },
  PACKED: { label: 'Packed', tone: 'teal' },
  SHIPPED: { label: 'Shipped', tone: 'teal' },
  DELIVERED: { label: 'Delivered', tone: 'good' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  RETURN_REQUESTED: { label: 'Return requested', tone: 'warn' },
  RETURNED: { label: 'Returned', tone: 'neutral' },
  PENDING_PAYMENT: { label: 'Awaiting payment', tone: 'neutral' },
};
