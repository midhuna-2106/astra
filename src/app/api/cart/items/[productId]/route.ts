import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface CartItem {
  product_id: string;
  name: string;
  price: number;
  unit_price: number;
  quantity: number;
  stock?: number;
}

async function ensureCart(userId: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase.from('carts').select('id').eq('user_id', userId).maybeSingle();
  if (existing) return existing.id;
  const { data: created } = await supabase.from('carts').insert({ user_id: userId }).select('id').single();
  return created!.id;
}

/** Read the current cart items for a user directly from the DB (source of truth). */
async function loadCartFromDB(userId: string): Promise<CartItem[]> {
  const cartId = await ensureCart(userId);
  const supabase = getSupabaseAdmin();
  const { data: result } = await supabase
    .from('cart_items')
    .select('product_id, unit_price, quantity, products!inner(name, price)')
    .eq('cart_id', cartId);

  return result?.map(row => {
    const prod = Array.isArray(row.products) ? row.products[0] : row.products;
    const p = prod as { name: string; price: number } | null;
    return {
      product_id: row.product_id,
      name: p?.name ?? '',
      price: Number(p?.price ?? 0),
      unit_price: Number(row.unit_price),
      quantity: row.quantity,
    };
  }) ?? [];
}

/**
 * Persist the full cart item list to the DB for a user.
 * Deletes all existing rows then re-inserts — simple and correct.
 * Always awaited so the caller knows the write is complete before responding.
 */
async function syncCartToDB(userId: string, items: CartItem[]): Promise<void> {
  const cartId = await ensureCart(userId);
  const supabase = getSupabaseAdmin();
  await supabase.from('cart_items').delete().eq('cart_id', cartId);
  for (const item of items) {
    if (item.quantity > 0) {
      await supabase.from('cart_items').upsert({
        cart_id: cartId,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price
      }, { onConflict: 'cart_id, product_id' });
    }
  }
}

/**
 * PATCH /api/cart/items/:productId — update item quantity in cart.
 * R01 FIX: Always reads from DB (not ephemeral InMemory Redis) and
 * awaits syncCartToDB so the write is complete before returning 200.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { productId } = await params;
    const body = await req.json() as { quantity?: number };
    const { quantity } = body;

    if (quantity == null || typeof quantity !== 'number') {
      return NextResponse.json({ error: 'quantity must be a number' }, { status: 400 });
    }

    // R01 FIX: Always load from DB — the durable source of truth.
    let items = await loadCartFromDB(session.userId);

    const existing = items.find((i) => i.product_id === productId);
    if (!existing) {
      return NextResponse.json({ error: 'Item not in cart' }, { status: 404 });
    }

    if (quantity <= 0) {
      items = items.filter((i) => i.product_id !== productId);
    } else {
      existing.quantity = quantity;
    }

    // R01 FIX: await so the DB write finishes before the client receives 200.
    await syncCartToDB(session.userId, items);

    return NextResponse.json({ data: items, error: null });
  } catch (err) {
    console.error('[cart item PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/cart/items/:productId — remove an item from the cart.
 * R01 FIX: Always reads from DB and awaits syncCartToDB.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { productId } = await params;

    // R01 FIX: Always load from DB — the durable source of truth.
    let items = await loadCartFromDB(session.userId);

    items = items.filter((i) => i.product_id !== productId);

    // R01 FIX: await so the DB write finishes before the client receives 200.
    await syncCartToDB(session.userId, items);

    return NextResponse.json({ data: items, error: null });
  } catch (err) {
    console.error('[cart item DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
