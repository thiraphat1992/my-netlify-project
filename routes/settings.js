const express = require('express')
const router = express.Router()
const { requireAuth } = require('../middleware/auth')
const { supabaseAdmin } = require('../config/supabase')

// Load all settings as key→value map
async function getSettings() {
  const { data } = await supabaseAdmin.from('settings').select('key, value')
  const map = {}
  ;(data || []).forEach(r => { map[r.key] = r.value || '' })
  return map
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const [cfg, { data: shopeeStores }, { data: lazadaStores }, { data: ecStores }] = await Promise.all([
      getSettings(),
      supabaseAdmin.from('ecommerce_stores').select('id,store_name,last_sync_at,is_active').eq('platform', 'shopee'),
      supabaseAdmin.from('ecommerce_stores').select('id,store_name,last_sync_at,is_active').eq('platform', 'lazada'),
      supabaseAdmin.from('ecommerce_stores').select('id,store_name,platform,is_active').in('platform', ['line_shopping', 'myshop', 'manual'])
    ])
    res.render('settings/index', {
      title: 'ตั้งค่าระบบ', activePage: 'settings',
      cfg,
      shopeeStores: shopeeStores || [],
      lazadaStores: lazadaStores || [],
      ecStores: ecStores || [],
      nodeEnv: process.env.NODE_ENV || 'development',
      appUrl: process.env.APP_URL || '',
      lineChannelId: !!process.env.LINE_CHANNEL_ID,
      lineAccessToken: !!process.env.LINE_ACCESS_TOKEN,
      success: req.flash('success'),
      error: req.flash('error')
    })
  } catch (err) {
    console.error('Settings load error:', err)
    res.render('settings/index', {
      title: 'ตั้งค่าระบบ', activePage: 'settings',
      cfg: {}, shopeeStores: [], lazadaStores: [], ecStores: [],
      nodeEnv: 'development', appUrl: '', lineChannelId: false, lineAccessToken: false,
      success: [], error: [err.message]
    })
  }
})

// Save company info
router.post('/company', requireAuth, async (req, res) => {
  const { company_name, company_address, company_tax_id, company_phone, company_email, app_url } = req.body
  try {
    const updates = { company_name, company_address, company_tax_id, company_phone, company_email, app_url }
    for (const [key, value] of Object.entries(updates)) {
      await supabaseAdmin.from('settings')
        .upsert({ key, value: value || '', updated_at: new Date() }, { onConflict: 'key' })
    }
    req.flash('success', 'บันทึกข้อมูลบริษัทเรียบร้อยแล้ว')
  } catch (err) {
    req.flash('error', `บันทึกไม่สำเร็จ: ${err.message}`)
  }
  res.redirect('/settings')
})

module.exports = router
module.exports.getSettings = getSettings
