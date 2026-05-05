const express = require('express')
const router = express.Router()
const https = require('https')
const crypto = require('crypto')
const { requireAuth } = require('../middleware/auth')
const { supabase, supabaseAdmin } = require('../config/supabase')

// ─── LINE signature verification ─────────────────────────────────────────────
function verifyLineSignature(channelSecret, rawBody, signatureHeader) {
  if (!channelSecret || !rawBody || !signatureHeader) return true // skip if no secret configured
  const hash = crypto.createHmac('sha256', channelSecret).update(rawBody).digest('base64')
  return hash === signatureHeader
}

// ─── LINE API helper ───────────────────────────────────────────────────────────
function lineRequest(path, method = 'GET', accessToken, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.line.me',
      path,
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
    const req = https.request(options, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, data }) }
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

// ─── Verify LINE access token & get bot info ──────────────────────────────────
async function verifyLineToken(accessToken) {
  if (!accessToken) return { ok: false, error: 'ไม่มี Access Token' }
  const res = await lineRequest('/v2/bot/info', 'GET', accessToken)
  if (res.status === 200) return { ok: true, botName: res.data.displayName, botId: res.data.userId }
  if (res.status === 401) return { ok: false, error: 'Access Token ไม่ถูกต้องหรือหมดอายุ' }
  return { ok: false, error: `LINE API: ${res.status}` }
}

// ─── Sync: LINE Shopping ใช้ Partner API (ต้องสมัครแยก) ─────────────────────
// ร้านค้าทั่วไปใช้ Webhook + Manual entry แทน
async function syncLineShoppingOrders(store) {
  if (!store.access_token) return { synced: 0, error: 'ไม่มี Access Token' }

  // ตรวจสอบ token ก่อน
  const verify = await verifyLineToken(store.access_token)
  if (!verify.ok) return { synced: 0, error: verify.error }

  // LINE Shopping Partner API — ต้องสมัครเป็น Partner กับ LINE ก่อน
  // https://developers.line.biz/en/docs/line-shopping/
  // ร้านค้าทั่วไปไม่สามารถเข้าถึง API นี้ได้โดยตรง
  // ทางเลือก: ใช้ Webhook รับออเดอร์อัตโนมัติ หรือ import CSV
  return {
    synced: 0,
    error: 'LINE Shopping Merchant API ต้องสมัครเป็น LINE Partner ก่อน — แนะนำให้ใช้ Webhook หรือ Import CSV แทน'
  }
}

function mapLineStatus(s) {
  const m = {
    WAIT_PAYMENT: 'pending', PAYMENT_RECEIVED: 'confirmed',
    PREPARING: 'packing', SHIPPED: 'shipped', DELIVERED: 'delivered',
    CANCEL: 'cancelled', RETURN: 'returned'
  }
  return m[s] || 'pending'
}

// ─── Dashboard / Orders list ──────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { status, store_id, q } = req.query
  try {
    const [{ data: stores }, { data: chatsRaw }] = await Promise.all([
      supabase.from('ecommerce_stores').select('*').order('created_at'),
      supabase.from('ecommerce_chats').select('*').order('last_message_at', { ascending: false }).limit(50)
    ])

    let query = supabase
      .from('ecommerce_orders')
      .select('*, items:ecommerce_order_items(*), store:ecommerce_stores(store_name, platform)')
      .order('ordered_at', { ascending: false })
      .limit(200)

    if (status) query = query.eq('status', status)
    if (store_id) query = query.eq('store_id', store_id)
    if (q) query = query.or(`customer_name.ilike.%${q}%,tracking_no.ilike.%${q}%,platform_order_id.ilike.%${q}%`)

    const { data: orders } = await query

    const allOrders = orders || []
    const stats = {
      total: allOrders.length,
      pending: allOrders.filter(o => o.status === 'pending').length,
      packing: allOrders.filter(o => ['confirmed','packing','packed'].includes(o.status)).length,
      shipped: allOrders.filter(o => o.status === 'shipped').length,
      delivered: allOrders.filter(o => o.status === 'delivered').length,
      revenue: allOrders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (parseFloat(o.total) || 0), 0)
    }

    res.render('ecommerce/index', {
      title: 'อีคอมเมิร์ซ', activePage: 'ecommerce',
      orders: allOrders, stores: stores || [], chats: chatsRaw || [],
      stats, filters: { status, store_id, q },
      success: req.flash('success'), error: req.flash('error')
    })
  } catch (err) {
    console.error(err)
    res.render('ecommerce/index', {
      title: 'อีคอมเมิร์ซ', activePage: 'ecommerce',
      orders: [], stores: [], chats: [], stats: { total: 0, pending: 0, packing: 0, shipped: 0, delivered: 0, revenue: 0 },
      filters: {}, success: [], error: ['โหลดข้อมูลไม่สำเร็จ: ' + err.message]
    })
  }
})

// ─── Create order manually ────────────────────────────────────────────────────
router.post('/orders', requireAuth, async (req, res) => {
  const { customer_name, customer_phone, customer_address, customer_district,
    customer_province, customer_postal_code, shipping_provider, shipping_fee,
    payment_method, notes, store_id, items } = req.body
  try {
    const itemsArr = Array.isArray(items) ? items : [items].filter(Boolean)
    const subtotal = itemsArr.reduce((s, item) => s + (parseFloat(item.qty) * parseFloat(item.unit_price) || 0), 0)
    const total = subtotal + (parseFloat(shipping_fee) || 0)

    const { data: order, error } = await supabaseAdmin.from('ecommerce_orders').insert([{
      store_id: store_id || null,
      platform: 'manual',
      customer_name, customer_phone,
      customer_address, customer_district, customer_province, customer_postal_code,
      shipping_provider: shipping_provider || 'ไปรษณีย์ไทย',
      shipping_fee: parseFloat(shipping_fee) || 0,
      subtotal, total, payment_method: payment_method || 'cod', notes
    }]).select().single()
    if (error) throw error

    if (itemsArr.length > 0) {
      await supabaseAdmin.from('ecommerce_order_items').insert(
        itemsArr.filter(i => i.product_name).map(item => ({
          order_id: order.id,
          product_name: item.product_name,
          sku: item.sku || null,
          variant: item.variant || null,
          qty: parseInt(item.qty) || 1,
          unit_price: parseFloat(item.unit_price) || 0,
          line_total: (parseInt(item.qty) || 1) * (parseFloat(item.unit_price) || 0)
        }))
      )
    }
    req.flash('success', 'เพิ่มออเดอร์เรียบร้อยแล้ว')
  } catch (err) {
    req.flash('error', 'เพิ่มออเดอร์ไม่สำเร็จ: ' + err.message)
  }
  res.redirect('/ecommerce')
})

// ─── Update order status / tracking ──────────────────────────────────────────
router.post('/orders/:id/update', requireAuth, async (req, res) => {
  const { status, tracking_no, shipping_provider, notes } = req.body
  try {
    const updates = { updated_at: new Date() }
    if (status) updates.status = status
    if (tracking_no !== undefined) updates.tracking_no = tracking_no || null
    if (shipping_provider) updates.shipping_provider = shipping_provider
    if (notes !== undefined) updates.notes = notes

    const { error } = await supabaseAdmin.from('ecommerce_orders').update(updates).eq('id', req.params.id)
    if (error) throw error
    req.flash('success', 'อัปเดตออเดอร์เรียบร้อยแล้ว')
  } catch (err) {
    req.flash('error', 'อัปเดตไม่สำเร็จ')
  }
  res.redirect('/ecommerce')
})

// ─── Mark label printed ───────────────────────────────────────────────────────
router.post('/orders/:id/label-printed', requireAuth, async (req, res) => {
  await supabaseAdmin.from('ecommerce_orders').update({
    label_printed: true, label_printed_at: new Date()
  }).eq('id', req.params.id)
  res.json({ ok: true })
})

// ─── Label print view (minimal layout) ───────────────────────────────────────
router.get('/orders/:id/label', requireAuth, async (req, res) => {
  const { data: order } = await supabase
    .from('ecommerce_orders')
    .select('*, items:ecommerce_order_items(*), store:ecommerce_stores(store_name, sender_name, sender_phone, sender_address)')
    .eq('id', req.params.id)
    .single()
  if (!order) return res.redirect('/ecommerce')

  await supabaseAdmin.from('ecommerce_orders').update({ label_printed: true, label_printed_at: new Date() }).eq('id', req.params.id)

  res.render('ecommerce/label-print', {
    order,
    company: {
      name: process.env.COMPANY_NAME || 'ร้านค้า',
      phone: process.env.COMPANY_PHONE || '',
      address: process.env.COMPANY_ADDRESS || ''
    }
  })
})

// ─── Delete order ─────────────────────────────────────────────────────────────
router.delete('/orders/:id', requireAuth, async (req, res) => {
  try {
    await supabaseAdmin.from('ecommerce_orders').delete().eq('id', req.params.id)
    req.flash('success', 'ลบออเดอร์แล้ว')
  } catch (err) {
    req.flash('error', 'ลบไม่สำเร็จ')
  }
  res.redirect('/ecommerce')
})

// ─── Chat: reply via LINE Messaging API ──────────────────────────────────────
router.post('/chat/:chatId/reply', requireAuth, async (req, res) => {
  const { message } = req.body
  try {
    const { data: chat } = await supabase.from('ecommerce_chats').select('*, store:ecommerce_stores(access_token)').eq('id', req.params.chatId).single()
    if (!chat || !chat.platform_chat_id) throw new Error('ไม่พบแชท')

    if (chat.store?.access_token && chat.platform_chat_id) {
      await lineRequest('/v2/bot/message/push', 'POST', chat.store.access_token, {
        to: chat.platform_chat_id,
        messages: [{ type: 'text', text: message }]
      })
    }

    await supabaseAdmin.from('ecommerce_chat_messages').insert([{
      chat_id: chat.id, sender_type: 'merchant', message, sent_at: new Date()
    }])
    await supabaseAdmin.from('ecommerce_chats').update({ last_message: message, last_message_at: new Date() }).eq('id', chat.id)

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ─── LINE Messaging webhook ───────────────────────────────────────────────────
router.post('/webhook/:storeId', async (req, res) => {
  // ตอบ 200 ก่อนเสมอ (LINE ต้องการ response ภายใน 15 วินาที)
  res.sendStatus(200)

  const { storeId } = req.params
  const signature = req.headers['x-line-signature']

  // โหลด store config
  const { data: store } = await supabase.from('ecommerce_stores')
    .select('id, channel_secret, access_token').eq('id', storeId).single()
  if (!store) return

  // ตรวจสอบ signature (ป้องกัน request ปลอม)
  if (store.channel_secret && req.rawBody) {
    if (!verifyLineSignature(store.channel_secret, req.rawBody, signature)) {
      console.warn('[LINE Webhook] Invalid signature for store', storeId)
      return
    }
  }

  const events = req.body?.events || []
  for (const ev of events) {
    const userId = ev.source?.userId
    if (!userId) continue

    // ดึง/สร้าง chat record
    const chat = await getOrCreateChat(storeId, userId, store.access_token)
    if (!chat) continue

    if (ev.type === 'message') {
      const msgText = ev.message?.type === 'text' ? ev.message.text : null
      const mediaUrl = ['image','video','audio','file'].includes(ev.message?.type)
        ? `line://message/${ev.message.id}` : null

      // บันทึกข้อความ
      await supabaseAdmin.from('ecommerce_chat_messages').insert([{
        chat_id: chat.id,
        sender_type: 'customer',
        message: msgText || `[${ev.message?.type || 'unknown'}]`,
        message_type: ev.message?.type || 'text',
        media_url: mediaUrl,
        sent_at: new Date(ev.timestamp)
      }])

      // อัปเดต last_message
      await supabaseAdmin.from('ecommerce_chats').update({
        last_message: msgText || `[${ev.message?.type}]`,
        last_message_at: new Date(ev.timestamp),
        unread_count: (chat.unread_count || 0) + 1
      }).eq('id', chat.id)

    } else if (ev.type === 'follow') {
      // ลูกค้า follow LINE OA
      await supabaseAdmin.from('ecommerce_chats').update({
        status: 'open', last_message: '👋 ลูกค้า Follow ร้านค้า',
        last_message_at: new Date(ev.timestamp)
      }).eq('id', chat.id)

    } else if (ev.type === 'unfollow') {
      // ลูกค้า unfollow
      await supabaseAdmin.from('ecommerce_chats').update({ status: 'closed' }).eq('id', chat.id)
    }
  }
})

// ดึงหรือสร้าง chat + ดึงชื่อลูกค้าจาก LINE Profile API
async function getOrCreateChat(storeId, userId, accessToken) {
  const { data: existing } = await supabase.from('ecommerce_chats')
    .select('*').eq('platform_chat_id', userId).eq('store_id', storeId).single()
  if (existing) return existing

  // ดึงโปรไฟล์ลูกค้าจาก LINE
  let customerName = userId
  let avatarUrl = null
  if (accessToken) {
    try {
      const profile = await lineRequest(`/v2/bot/profile/${userId}`, 'GET', accessToken)
      if (profile.status === 200 && profile.data?.displayName) {
        customerName = profile.data.displayName
        avatarUrl = profile.data.pictureUrl || null
      }
    } catch (_) {}
  }

  const { data: newChat } = await supabaseAdmin.from('ecommerce_chats').insert([{
    store_id: storeId,
    platform: 'line',
    platform_chat_id: userId,
    customer_name: customerName,
    customer_avatar: avatarUrl,
    customer_line_id: userId,
    status: 'open',
    unread_count: 0
  }]).select().single()

  return newChat
}

// ─── Verify LINE token (API) ──────────────────────────────────────────────────
router.get('/api/verify-line/:storeId', requireAuth, async (req, res) => {
  const { data: store } = await supabase.from('ecommerce_stores')
    .select('access_token, store_name').eq('id', req.params.storeId).single()
  if (!store) return res.json({ ok: false, error: 'ไม่พบร้านค้า' })
  const result = await verifyLineToken(store.access_token)
  res.json(result)
})

// ─── Import orders from CSV (LINE Shopping export) ────────────────────────────
router.post('/import-csv/:storeId', requireAuth, async (req, res) => {
  const { csv_data } = req.body
  const { storeId } = req.params
  if (!csv_data) { req.flash('error', 'ไม่มีข้อมูล CSV'); return res.redirect('/ecommerce?tab=settings') }

  try {
    const lines = csv_data.trim().split('\n').filter(l => l.trim())
    if (lines.length < 2) throw new Error('ไฟล์ CSV ต้องมีอย่างน้อย 2 แถว (header + data)')

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase())
    let imported = 0

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i])
      const row = {}
      headers.forEach((h, idx) => { row[h] = (cols[idx] || '').trim() })

      const orderId = row['order id'] || row['orderid'] || row['เลขออเดอร์'] || `CSV-${Date.now()}-${i}`
      const { data: exists } = await supabase.from('ecommerce_orders')
        .select('id').eq('platform_order_id', orderId).eq('store_id', storeId).maybeSingle()
      if (exists) continue

      const total = parseFloat(row['total'] || row['ยอดรวม'] || row['amount'] || 0)
      const shippingFee = parseFloat(row['shipping fee'] || row['ค่าส่ง'] || 0)

      await supabaseAdmin.from('ecommerce_orders').insert([{
        store_id: storeId,
        platform_order_id: orderId,
        platform: 'line_shopping',
        status: mapCSVStatus(row['status'] || row['สถานะ'] || ''),
        customer_name: row['recipient name'] || row['ชื่อผู้รับ'] || row['customer'] || 'ลูกค้า',
        customer_phone: row['phone'] || row['เบอร์โทร'] || '',
        customer_address: row['address'] || row['ที่อยู่'] || '',
        customer_province: row['province'] || row['จังหวัด'] || '',
        customer_postal_code: row['zip'] || row['postal code'] || row['รหัสไปรษณีย์'] || '',
        shipping_provider: row['carrier'] || row['ขนส่ง'] || 'ไปรษณีย์ไทย',
        tracking_no: row['tracking'] || row['tracking no'] || row['เลข tracking'] || null,
        subtotal: total - shippingFee,
        shipping_fee: shippingFee,
        total,
        payment_method: (row['payment'] || '').toLowerCase().includes('cod') ? 'cod' : 'transfer',
        ordered_at: row['date'] || row['order date'] || row['วันที่'] ? new Date(row['date'] || row['order date'] || row['วันที่']) : new Date()
      }])
      imported++
    }

    req.flash('success', `Import สำเร็จ ${imported} ออเดอร์ (ข้ามที่มีอยู่แล้ว)`)
  } catch (err) {
    req.flash('error', 'Import ไม่สำเร็จ: ' + err.message)
  }
  res.redirect('/ecommerce')
})

function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { result.push(current); current = '' }
    else { current += ch }
  }
  result.push(current)
  return result
}

function mapCSVStatus(s) {
  const lower = s.toLowerCase()
  if (lower.includes('ship') || lower.includes('จัดส่ง')) return 'shipped'
  if (lower.includes('deliver') || lower.includes('ส่งถึง')) return 'delivered'
  if (lower.includes('cancel') || lower.includes('ยกเลิก')) return 'cancelled'
  if (lower.includes('pack') || lower.includes('แพ็ค')) return 'packed'
  if (lower.includes('confirm') || lower.includes('ยืนยัน')) return 'confirmed'
  return 'pending'
}

// ─── Sync from platform ───────────────────────────────────────────────────────
router.post('/sync/:storeId', requireAuth, async (req, res) => {
  const { data: store } = await supabase.from('ecommerce_stores').select('*').eq('id', req.params.storeId).single()
  if (!store) return res.json({ ok: false, error: 'ไม่พบร้านค้า' })

  // ตรวจสอบ token ก่อน sync
  if (store.access_token) {
    const verify = await verifyLineToken(store.access_token)
    if (!verify.ok) {
      req.flash('error', `LINE Token: ${verify.error}`)
      return res.redirect('/ecommerce?tab=settings')
    }
    req.flash('success', `✓ เชื่อมต่อ LINE OA "${verify.botName}" สำเร็จ — ระบบรับออเดอร์ผ่าน Webhook อัตโนมัติ`)
    await supabaseAdmin.from('ecommerce_stores').update({ last_sync_at: new Date() }).eq('id', store.id)
  } else {
    req.flash('error', 'กรุณากรอก Access Token ในหน้าตั้งค่าร้านค้าก่อน')
  }
  res.redirect('/ecommerce?tab=settings')
})

// ─── Store settings: save ────────────────────────────────────────────────────
router.post('/stores', requireAuth, async (req, res) => {
  const { store_name, platform, shop_id, channel_id, channel_secret,
    access_token, webhook_secret, sender_name, sender_phone, sender_address } = req.body
  try {
    const { error } = await supabaseAdmin.from('ecommerce_stores').insert([{
      store_name, platform, shop_id: shop_id || null,
      channel_id: channel_id || null, channel_secret: channel_secret || null,
      access_token: access_token || null, webhook_secret: webhook_secret || null,
      sender_name, sender_phone, sender_address
    }])
    if (error) throw error
    req.flash('success', `เชื่อมต่อร้านค้า "${store_name}" แล้ว`)
  } catch (err) {
    req.flash('error', 'บันทึกไม่สำเร็จ: ' + err.message)
  }
  res.redirect('/ecommerce?tab=settings')
})

router.put('/stores/:id', requireAuth, async (req, res) => {
  const { store_name, channel_id, channel_secret, access_token,
    webhook_secret, sender_name, sender_phone, sender_address, is_active } = req.body
  try {
    await supabaseAdmin.from('ecommerce_stores').update({
      store_name, channel_id: channel_id || null, channel_secret: channel_secret || null,
      access_token: access_token || null, webhook_secret: webhook_secret || null,
      sender_name, sender_phone, sender_address,
      is_active: is_active === 'true', updated_at: new Date()
    }).eq('id', req.params.id)
    req.flash('success', 'อัปเดตร้านค้าแล้ว')
  } catch (err) {
    req.flash('error', 'อัปเดตไม่สำเร็จ')
  }
  res.redirect('/ecommerce?tab=settings')
})

router.delete('/stores/:id', requireAuth, async (req, res) => {
  try {
    await supabaseAdmin.from('ecommerce_stores').delete().eq('id', req.params.id)
    req.flash('success', 'ลบร้านค้าแล้ว')
  } catch (err) {
    req.flash('error', 'ลบไม่สำเร็จ')
  }
  res.redirect('/ecommerce?tab=settings')
})

// ─── API: get chat messages ───────────────────────────────────────────────────
router.get('/api/chat/:chatId/messages', requireAuth, async (req, res) => {
  const { data } = await supabase
    .from('ecommerce_chat_messages')
    .select('*')
    .eq('chat_id', req.params.chatId)
    .order('sent_at')
    .limit(100)
  res.json(data || [])
})

// ─── API: get order detail ────────────────────────────────────────────────────
router.get('/api/orders/:id', requireAuth, async (req, res) => {
  const { data } = await supabase
    .from('ecommerce_orders')
    .select('*, items:ecommerce_order_items(*), store:ecommerce_stores(store_name)')
    .eq('id', req.params.id)
    .single()
  res.json(data || null)
})

module.exports = router
