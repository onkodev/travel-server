import { Injectable, Logger } from '@nestjs/common';

export interface WcOrderData {
  orderId: number;
  status: string;
  statusLabel: string;
  total: string;
  currency: string;
  dateCreated: string;
  datePaid: string | null;
  paymentMethod: string;
  paymentStatus: string;
  customerName: string;
  customerEmail: string;
  items: Array<{
    name: string;
    quantity: number;
    total: string;
  }>;
  shippingPickupLocation?: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending Payment',
  processing: 'Processing',
  'on-hold': 'On Hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  failed: 'Failed',
};

@Injectable()
export class WooCommerceService {
  private readonly logger = new Logger(WooCommerceService.name);
  private readonly apiUrl = process.env.WC_API_URL;
  private readonly consumerKey = process.env.WC_CONSUMER_KEY;
  private readonly consumerSecret = process.env.WC_CONSUMER_SECRET;

  private getAuthHeader(): string {
    return 'Basic ' + Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
  }

  /**
   * 주문번호로 조회
   */
  async getOrderById(orderId: number): Promise<WcOrderData | null> {
    try {
      const res = await fetch(`${this.apiUrl}/orders/${orderId}`, {
        headers: { Authorization: this.getAuthHeader() },
      });
      if (!res.ok) {
        this.logger.warn(`WC order ${orderId} not found: ${res.status}`);
        return null;
      }
      const order = await res.json();
      return this.mapOrder(order);
    } catch (error) {
      this.logger.error(`WC API error (orderId: ${orderId}):`, error);
      return null;
    }
  }

  /**
   * 이메일로 주문 조회 (최근 5건)
   */
  async getOrdersByEmail(email: string): Promise<WcOrderData[]> {
    try {
      const res = await fetch(
        `${this.apiUrl}/orders?search=${encodeURIComponent(email)}&per_page=5&orderby=date&order=desc`,
        { headers: { Authorization: this.getAuthHeader() } },
      );
      if (!res.ok) {
        this.logger.warn(`WC orders by email failed: ${res.status}`);
        return [];
      }
      const orders = await res.json();
      return orders
        .filter((o: any) => o.billing?.email?.toLowerCase() === email.toLowerCase())
        .map((o: any) => this.mapOrder(o));
    } catch (error) {
      this.logger.error(`WC API error (email: ${email}):`, error);
      return [];
    }
  }

  private mapOrder(order: any): WcOrderData {
    // pickup location 추출 (meta_data에서)
    const pickupMeta = order.meta_data?.find(
      (m: any) => m.key === 'shipping_pickup_location' || m.key === '_shipping_pickup_location',
    );

    return {
      orderId: order.id,
      status: order.status,
      statusLabel: STATUS_LABELS[order.status] || order.status,
      total: order.total,
      currency: order.currency || 'USD',
      dateCreated: order.date_created,
      datePaid: order.date_paid,
      paymentMethod: order.payment_method_title || order.payment_method,
      paymentStatus: order.date_paid ? 'Paid' : 'Unpaid',
      customerName: `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim(),
      customerEmail: order.billing?.email || '',
      items: (order.line_items || []).map((item: any) => ({
        name: item.name,
        quantity: item.quantity,
        total: item.total,
      })),
      shippingPickupLocation: pickupMeta?.value || undefined,
    };
  }

  /**
   * 주문 데이터를 챗봇 컨텍스트용 문자열로 변환
   */
  formatOrderForContext(order: WcOrderData): string {
    const lines = [
      `Order #${order.orderId}`,
      `Status: ${order.statusLabel}`,
      `Total: $${order.total} ${order.currency}`,
      `Payment: ${order.paymentMethod} (${order.paymentStatus})`,
      `Date: ${order.dateCreated}`,
      order.datePaid ? `Paid: ${order.datePaid}` : null,
      `Customer: ${order.customerName}`,
      `Items:`,
      ...order.items.map(i => `  - ${i.name} x${i.quantity} ($${i.total})`),
      order.shippingPickupLocation ? `Pickup: ${order.shippingPickupLocation}` : null,
    ];
    return lines.filter(Boolean).join('\n');
  }
}
