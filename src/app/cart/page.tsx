"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";

interface CartItem { product_id: string; name: string; unit_price: number; quantity: number; stock: number; }

export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ name: string; role: string } | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState<{ discount: number; total: number; code: string } | null>(null);
  const [couponError, setCouponError] = useState("");

  async function loadCart() {
    const res = await fetch("/api/cart");
    // R01 FIX: Always resolve loading state regardless of response status.
    // Previously a non-OK response (e.g. 401 for unauthenticated) would leave
    // loading=true forever, showing "Loading cart..." indefinitely.
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const data = await res.json();
    setItems(data.data?.items ?? []);
    setTotal(data.data?.total ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => setUser(d?.data ?? null)).catch(() => null);
    loadCart();
  }, []);

  async function updateQty(productId: string, qty: number) {
    if (qty === 0) { await removeItem(productId); return; }
    // Always reload from DB after mutation so displayed state matches persisted state.
    // If the PATCH fails, loadCart() restores the correct DB state.
    try {
      await fetch(`/api/cart/items/${productId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: qty }) });
    } finally {
      await loadCart();
    }
  }

  async function removeItem(productId: string) {
    // Always reload from DB after mutation so displayed state matches persisted state.
    // If the DELETE fails, loadCart() restores the correct DB state.
    try {
      await fetch(`/api/cart/items/${productId}`, { method: "DELETE" });
    } finally {
      await loadCart();
    }
  }

  async function applyCoupon() {
    setCouponError(""); setCouponResult(null);
    const res = await fetch("/api/cart/coupon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: couponCode }) });
    const data = await res.json();
    if (!res.ok) { setCouponError(data.error); return; }
    setCouponResult(data.data);
  }

  if (loading) return <><Nav user={user} /><div className="text-center py-20 text-slate-400">Loading cart...</div></>;

  return (
    <>
      <Nav cartCount={items.length} user={user} />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-white mb-6">Shopping Cart</h1>
        {items.length === 0 ? (
          <div className="text-center py-20 card p-12" data-testid="empty-cart">
            <p className="text-slate-400 mb-4">Your cart is empty</p>
            <Link href="/" className="btn-primary">Browse Products</Link>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-3" data-testid="cart-items">
              {items.map(item => (
                <div key={item.product_id} className="card p-4 flex items-center gap-4" data-testid="cart-item" data-product-id={item.product_id}>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white text-sm">{item.name}</p>
                    <p className="text-indigo-400 font-semibold">?{Number(item.unit_price).toLocaleString("en-IN")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateQty(item.product_id, item.quantity - 1)} className="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center" data-testid="qty-decrease">-</button>
                    <span className="text-white font-medium w-8 text-center" data-testid="item-quantity">{item.quantity}</span>
                    <button onClick={() => updateQty(item.product_id, item.quantity + 1)} className="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center" data-testid="qty-increase">+</button>
                  </div>
                  <button onClick={() => removeItem(item.product_id)} className="text-red-400 hover:text-red-300 text-sm ml-2" data-testid="remove-item">Remove</button>
                </div>
              ))}
            </div>
            <div className="card p-5 h-fit space-y-4" data-testid="cart-summary">
              <h2 className="font-semibold text-white">Order Summary</h2>
              <div className="flex gap-2">
                <input data-testid="coupon-input" type="text" placeholder="Coupon code" value={couponCode} onChange={e => setCouponCode(e.target.value.toUpperCase())} className="input text-sm" />
                <button onClick={applyCoupon} className="btn-secondary text-sm whitespace-nowrap" data-testid="apply-coupon">Apply</button>
              </div>
              {couponError && <p className="text-red-400 text-xs" data-testid="coupon-error">{couponError}</p>}
              {couponResult && <p className="text-emerald-400 text-xs" data-testid="coupon-success">? {couponResult.code}: -?{couponResult.discount}</p>}
              <div className="border-t border-slate-700 pt-3">
                <div className="flex justify-between text-sm text-slate-400"><span>Subtotal</span><span>?{total.toLocaleString("en-IN")}</span></div>
                {couponResult && <div className="flex justify-between text-sm text-emerald-400"><span>Discount</span><span>-?{couponResult.discount}</span></div>}
                <div className="flex justify-between font-bold text-white mt-2 text-lg">
                  <span>Total</span>
                  <span data-testid="cart-total">?{(couponResult?.total ?? total).toLocaleString("en-IN")}</span>
                </div>
              </div>
              <Link href="/checkout" className="btn-primary w-full text-center block" data-testid="checkout-btn">Proceed to Checkout</Link>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
