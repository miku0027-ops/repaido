import { apiFetch } from './api';

export interface CartItem {
  id: string;
  title: string;
  price_paise: number;
  quantity: number;
  image_url?: string;
  shop_id?: string;
  shop_name?: string;
  category?: string;
  condition?: string;
  stock?: number;
}

export interface CartTotals {
  subtotal_paise: number;
  gst_paise: number;
  delivery_fee_paise: number;
  total_paise: number;
  itemCount: number;
}

export interface CartOrderPayload {
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  city: string;
  pincode: string;
  payment_method: 'upi' | 'card' | 'netbanking' | 'cod';
  order_notes?: string;
}

const STORAGE_KEY = 'repaido.customer.cart';
const ORDERS_STORAGE_KEY = 'repaido.spare_orders';

class CartService {
  private items: CartItem[] = [];
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadFromStorage();
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) {
          this.loadFromStorage();
          this.notify();
        }
      });
      window.addEventListener('repaido:cart-sync', () => {
        this.loadFromStorage();
        this.notify();
      });
    }
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.items = parsed;
          return;
        }
      }
    } catch {
      // ignore
    }
    this.items = [];
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
      window.dispatchEvent(new CustomEvent('repaido:cart-updated', { detail: { count: this.getItemCount() } }));
    } catch {
      // ignore
    }
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error('Cart listener error:', e);
      }
    });
  }

  public subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  public getItems(): CartItem[] {
    return [...this.items];
  }

  public getItemCount(): number {
    return this.items.reduce((sum, item) => sum + (item.quantity || 1), 0);
  }

  public addItem(item: Partial<CartItem> & { id: string; title: string; price_paise: number }, qty: number = 1): void {
    const existingIndex = this.items.findIndex((i) => i.id === item.id);
    const maxStock = item.stock && item.stock > 0 ? item.stock : 99;

    if (existingIndex > -1) {
      const current = this.items[existingIndex];
      const nextQty = Math.min(maxStock, current.quantity + qty);
      this.items[existingIndex] = { ...current, quantity: nextQty };
    } else {
      this.items.push({
        id: item.id,
        title: item.title,
        price_paise: Math.round(item.price_paise),
        quantity: Math.min(maxStock, Math.max(1, qty)),
        image_url: item.image_url,
        shop_id: item.shop_id,
        shop_name: item.shop_name,
        category: item.category,
        condition: item.condition || 'new',
        stock: item.stock
      });
    }
    this.saveToStorage();
  }

  public updateQuantity(id: string, delta: number): void {
    const index = this.items.findIndex((i) => i.id === id);
    if (index === -1) return;

    const current = this.items[index];
    const maxStock = current.stock && current.stock > 0 ? current.stock : 99;
    const nextQty = current.quantity + delta;

    if (nextQty <= 0) {
      this.items.splice(index, 1);
    } else {
      this.items[index] = { ...current, quantity: Math.min(maxStock, nextQty) };
    }
    this.saveToStorage();
  }

  public removeItem(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
    this.saveToStorage();
  }

  public clearCart(): void {
    this.items = [];
    this.saveToStorage();
  }

  public getTotals(): CartTotals {
    const subtotal_paise=this.items.reduce((sum,item)=>sum+item.price_paise*item.quantity,0);
    return {subtotal_paise,gst_paise:0,delivery_fee_paise:0,total_paise:subtotal_paise,itemCount:this.getItemCount()};
  }
}
export const cartService = new CartService();
