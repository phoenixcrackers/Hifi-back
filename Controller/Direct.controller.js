const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const multer = require('multer');

const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const pdfDir = path.join(__dirname, '../pdf_data');
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }
    cb(null, pdfDir);
  },
  filename: (req, file, cb) => {
    const { customer_name, order_id } = req.body;
    const safeCustomerName = customer_name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    cb(null, `${safeCustomerName}-${order_id}.pdf`);
  }
});
const upload = multer({ storage });

const drawTableRow = (doc, y, colX, colWidths, values, alignOptions = []) => {
  values.forEach((val, i) => {
    const textVal = typeof val === 'object' && val.text ? val.text : val;
    const align = (alignOptions[i] || 'center');
    doc.text(textVal, colX[i] + 5, y, { width: colWidths[i] - 10, align });
  });
  doc.moveTo(50, y + 15).lineTo(550, y + 15).stroke();
  colX.forEach((x, i) => doc.moveTo(x, y - 5).lineTo(x, y + 15).stroke());
  doc.moveTo(550, y - 5).lineTo(550, y + 15).stroke();
};

const generateInvoicePDF = (bookingData, customerDetails, products, dispatchLogs = [], payments = [], extraCharges = {}) => {
  return new Promise((resolve, reject) => {
    if (!bookingData || !customerDetails || !Array.isArray(products)) {
      return reject(new Error('Invalid input: bookingData, customerDetails, and products required'));
    }

    const doc = new PDFDocument({ margin: 50 });
    const safeName = (customerDetails.customer_name || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const pdfDir = path.join(__dirname, 'receipt');
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }
    const pdfPath = path.join(pdfDir, `${safeName}-${bookingData.order_id || 'unknown'}-receipt.pdf`);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('Receipt', 50, 50, { align: 'center' });
    doc.fontSize(12).font('Helvetica')
      .text('Hifi Pyro Park', 50, 80, { align: 'center' })
      .text('Anil Kumar Eye Hospital Opp, Sattur Road, Sivakasi', 50, 95, { align: 'center' })
      .text('Mobile: +91 63836 59214', 50, 110, { align: 'center' })
      .text('Email: nivasramasamy27@gmail.com', 50, 125, { align: 'center' })
      .text(`Customer: ${customerDetails.customer_name || 'N/A'}`, 50, 160)
      .text(`Contact: ${customerDetails.mobile_number || 'N/A'}`, 50, 175)
      .text(`Address: ${customerDetails.address || 'N/A'}, ${customerDetails.district || 'N/A'}, ${customerDetails.state || 'N/A'}`, 50, 190)
      .text(`Order ID: ${bookingData.order_id || 'N/A'}`, 300, 160, { align: 'right' })
      .text(`Order Date: ${new Date(bookingData.created_at || Date.now()).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}`, 300, 175, { align: 'right' })
      .text(`Status: ${bookingData.status || 'N/A'}`, 300, 190, { align: 'right' });

    // Receipt Table
    let y = 250;
    const colWidths = [50, 200, 80, 80, 80, 80];
    const colX = [50, 100, 300, 380, 460, 540];
    doc.moveTo(50, y - 5).lineTo(570, y - 5).stroke();
    drawTableRow(doc, y, colX, colWidths, ['Sl.No', 'Description', 'Quantity', 'Rate/Box (₹)', 'Date', 'Amount (₹)'], ['center', 'left', 'right', 'right', 'right', 'right']);

    // Calculate debit and credit
    let debit = 0;
    const tableData = [
      ...dispatchLogs.map((log, index) => {
        const prod = products[log.product_index];
        const price = prod ? parseFloat(prod.price) || 0 : 0;
        const discount = prod ? parseFloat(prod.discount || 0) : 0;
        const effectivePrice = price - (price * discount / 100);
        const amount = effectivePrice * (log.dispatched_qty || 0);
        debit += amount;
        return {
          slNo: index + 1,
          productName: log.product_name || 'N/A',
          quantity: log.dispatched_qty || 0,
          ratePerBox: effectivePrice.toFixed(2),
          amount: `${amount.toFixed(2)} Dr`,
          date: new Date(log.dispatched_at).getTime(),
        };
      }),
      ...payments.map((payment, index) => ({
        slNo: dispatchLogs.length + index + 1,
        productName: `Payment (${payment.payment_method || 'N/A'})`,
        quantity: '-',
        ratePerBox: '-',
        amount: `${parseFloat(payment.amount_paid || 0).toFixed(2)} Cr`,
        date: new Date(payment.created_at).getTime(),
      })),
    ].sort((a, b) => b.date - a.date); // Sort by date, latest to earliest

    y += 25;
    tableData.forEach((row, index) => {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      drawTableRow(doc, y, colX, colWidths, [
        row.slNo,
        row.productName,
        row.quantity,
        row.ratePerBox,
        new Date(row.date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        row.amount,
      ], ['center', 'left', 'right', 'right', 'right', row.amount.includes('Dr') ? 'right' : 'right']);
      y += 20;
    });

    // Extra Charges (Tax, P&F, Deduction)
    y += 10;
    if (y > 700) {
      doc.addPage();
      y = 50;
    }
    const tax = parseFloat(extraCharges.tax || 0);
    const pf = parseFloat(extraCharges.pf || 0);
    const minus = parseFloat(extraCharges.minus || 0);
    if (tax || pf || minus) {
      const extraText = [
        tax ? `Tax: Rs.${tax.toFixed(2)}` : '',
        pf ? `P&F: Rs.${pf.toFixed(2)}` : '',
        minus ? `Deduction: -Rs.${minus.toFixed(2)}` : '',
      ].filter(Boolean).join('  ');
      doc.font('Helvetica').text(extraText, 450, y, { align: 'right' });
      y += 20;
      debit = debit + tax + pf - minus;
    }

    // Total Row
    const credit = payments.reduce((sum, p) => sum + parseFloat(p.amount_paid || 0), 0);
    const netBalance = credit - debit;
    const totalQty = products.reduce((sum, p) => sum + Number(p.quantity || 0), 0);
    if (y > 700) {
      doc.addPage();
      y = 50;
    }
    doc.moveTo(50, y - 5).lineTo(570, y - 5).stroke();
    drawTableRow(doc, y, colX, colWidths, [
      { text: 'Total', colSpan: 2 },
      totalQty,
      '-',
      '-',
      { text: `${netBalance.toFixed(2)} ${netBalance < 0 ? '(Outstanding)' : '(Advance)'}` },
    ], ['left', 'left', 'right', 'right', 'right', netBalance < 0 ? 'right' : 'right']);
    doc.moveTo(50, y - 5).lineTo(300, y - 5).stroke(); // Line for merged "Total" cell
    doc.moveTo(50, y + 15).lineTo(570, y + 15).stroke();
    colX.forEach((x, i) => doc.moveTo(x, y - 5).lineTo(x, y + 15).stroke());
    doc.moveTo(570, y - 5).lineTo(570, y + 15).stroke();

    doc.end();
    stream.on('finish', () => resolve({ pdfPath, calculatedTotal: netBalance }));
    stream.on('error', reject);
  });
};

exports.getCustomers = async (req, res) => {
  try {
    const query = `
      SELECT id, customer_name AS name, address, mobile_number, email, customer_type, district, state
      FROM public.gbcustomers
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch customers' });
  }
};

exports.getProductTypes = async (req, res) => {
  try {
    const result = await pool.query('SELECT product_type FROM public.products');
    res.status(200).json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch product types' });
  }
};

exports.getProductsByType = async (req, res) => {
  try {
    const productType = 'gift_box_dealers';
    const tableName = productType.toLowerCase().replace(/\s+/g, '_');
    const query = `
      SELECT id, serial_number, productname, price, per, discount, image, status, $1 AS product_type
      FROM public.${tableName}
      WHERE status = 'on'
    `;
    const result = await pool.query(query, [productType]);
    
    const products = result.rows.map(row => ({
      id: row.id,
      product_type: row.product_type,
      serial_number: row.serial_number,
      productname: row.productname,
      price: parseFloat(row.price),
      per: row.per,
      discount: parseFloat(row.discount),
      image: row.image,
      status: row.status
    }));
    
    res.status(200).json(products);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch products', error: err.message });
  }
};

exports.createBooking = async (req, res) => {
  try {
    const { customer_id, products, total, customer_type, customer_name, address, mobile_number, email, district, state, payment_method, amount_paid, admin_id } = req.body;

    // Generate order_id automatically in the format DORD-timestamp
    const order_id = `DORD-${Date.now()}`;

    if (!products || !Array.isArray(products) || products.length === 0) return res.status(400).json({ message: 'Products array is required and must not be empty' });
    if (!total || total <= 0) return res.status(400).json({ message: 'Total must be a positive number' });
    if (payment_method && !['cash', 'bank'].includes(payment_method)) return res.status(400).json({ message: 'Invalid payment method' });
    if (payment_method && (!amount_paid || amount_paid <= 0)) return res.status(400).json({ message: 'Amount paid must be a positive number when payment method is provided' });
    if (payment_method && !admin_id) return res.status(400).json({ message: 'Admin ID is required when payment method is provided' });

    let finalCustomerType = customer_type || 'User';
    let customerDetails = { customer_name, address, mobile_number, email, district, state };

    if (customer_id) {
      const customerCheck = await pool.query(
        'SELECT id, customer_name, address, mobile_number, email, district, state, customer_type FROM public.gbcustomers WHERE id = $1',
        [customer_id]
      );
      if (customerCheck.rows.length === 0) return res.status(404).json({ message: 'Customer not found' });
      const { customer_name: db_name, address: db_address, mobile_number: db_mobile, email: db_email, district: db_district, state: db_state, customer_type: dbCustomerType } = customerCheck.rows[0];
      finalCustomerType = customer_type || dbCustomerType || 'User';
      customerDetails = { customer_name: db_name, address: db_address, mobile_number: db_mobile, email: db_email, district: db_district, state: db_state };
    } else {
      if (finalCustomerType !== 'User') return res.status(400).json({ message: 'Customer type must be "User" for bookings without customer ID' });
      if (!customer_name) return res.status(400).json({ message: 'Customer name is required' });
      if (!address) return res.status(400).json({ message: 'Address is required' });
      if (!district) return res.status(400).json({ message: 'District is required' });
      if (!state) return res.status(400).json({ message: 'State is required' });
      if (!mobile_number) return res.status(400).json({ message: 'Mobile number is required' });
      if (!email) return res.status(400).json({ message: 'Email is required' });
    }

    // Validate products and check stock availability
    for (const product of products) {
      const { id, product_type, quantity } = product;
      if (!id || !product_type || !quantity || quantity < 1) return res.status(400).json({ message: 'Each product must have a valid ID, product type, and positive quantity' });
      const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
      const productCheck = await pool.query(`SELECT id, stock FROM public.${tableName} WHERE id = $1 AND status = 'on'`, [id]);
      if (productCheck.rows.length === 0) return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or not available` });
      if (quantity > productCheck.rows[0].stock) return res.status(400).json({ message: `Insufficient stock for product ${id} of type ${product_type}` });
    }

    // Start transaction to ensure consistency
    await pool.query('BEGIN');

    // Update stock for each product
    for (const product of products) {
      const { id, product_type, quantity } = product;
      const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
      await pool.query(`UPDATE public.${tableName} SET stock = stock - $1 WHERE id = $2`, [quantity, id]);
    }

    const pdfResult = await generateInvoicePDF({ order_id, customer_type: finalCustomerType, total }, customerDetails, products);

    // Insert booking with initial total, which will not be modified later
    const bookingQuery = `
      INSERT INTO public.dbooking (customer_id, order_id, products, total, address, mobile_number, customer_name, email, district, state, customer_type, status, created_at, pdf, payment_method, amount_paid, admin_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14, $15, $16)
      RETURNING id, created_at, customer_type, pdf, order_id
    `;
    const bookingValues = [
      customer_id || null, order_id, JSON.stringify(products), parseFloat(total),
      customerDetails.address || null, customerDetails.mobile_number || null,
      customerDetails.customer_name || null, customerDetails.email || null,
      customerDetails.district || null, customerDetails.state || null,
      finalCustomerType, 'booked', pdfResult.pdfPath, payment_method || null, parseFloat(amount_paid) || 0, admin_id || null
    ];
    const bookingResult = await pool.query(bookingQuery, bookingValues);

    // If payment is made, insert into payment_transactions table
    if (payment_method && amount_paid) {
      const transactionQuery = `
        INSERT INTO public.payment_transactions (booking_id, amount_paid, payment_method, admin_id, transaction_date)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING *
      `;
      const transactionValues = [bookingResult.rows[0].id, parseFloat(amount_paid), payment_method, admin_id];
      await pool.query(transactionQuery, transactionValues);
    }

    await pool.query('COMMIT');

    res.status(201).json({
      message: 'Booking created successfully',
      id: bookingResult.rows[0].id,
      created_at: bookingResult.rows[0].created_at,
      customer_type: bookingResult.rows[0].customer_type,
      pdf_path: bookingResult.rows[0].pdf,
      order_id: bookingResult.rows[0].order_id
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ message: 'Failed to create booking', error: err.message });
  }
};

exports.getInvoice = async (req, res) => {
  try {
    let { order_id } = req.params;

    if (order_id.endsWith('.pdf')) {
      order_id = order_id.replace(/\.pdf$/, '');
    }

    // Ensure order_id starts with 'DORD'
    if (!order_id.startsWith('DORD') || !/^[a-zA-Z0-9-_]+$/.test(order_id.slice(4))) {
      return res.status(400).json({ 
        message: 'Invalid order_id format', 
        details: 'Order ID must start with "DORD" followed by alphanumeric characters, hyphens, or underscores' 
      });
    }

    let bookingQuery = await pool.query(
      'SELECT products, total, customer_name, address, mobile_number, email, district, state, customer_type, pdf FROM public.dbooking WHERE order_id = $1',
      [order_id]
    );

    if (bookingQuery.rows.length === 0) {
      const parts = order_id.split('-');
      if (parts.length > 1 && parts[0] === 'DORD') {
        const possibleOrderId = parts.slice(1).join('-');
        bookingQuery = await pool.query(
          'SELECT products, total, customer_name, address, mobile_number, email, district, state, customer_type, pdf FROM public.dbooking WHERE order_id = $1',
          [`DORD-${possibleOrderId}`]
        );
      }
    }

    if (bookingQuery.rows.length === 0) {
      return res.status(404).json({ 
        message: 'Invoice not found', 
        details: `No booking found for order_id '${order_id}'. Please use an order_id starting with 'DORD' (e.g., 'DORD-1751548161837').`
      });
    }

    const { products, total, customer_name, address, mobile_number, email, district, state, customer_type, pdf } = bookingQuery.rows[0];

    if (!fs.existsSync(pdf)) {
      const regeneratedPdfPath = await generateInvoicePDF(
        { order_id: bookingQuery.rows[0].order_id, customer_type, total },
        { customer_name, address, mobile_number, email, district, state },
        JSON.parse(products)
      );
      await pool.query('UPDATE public.dbooking SET pdf = $1 WHERE order_id = $2', [regeneratedPdfPath, bookingQuery.rows[0].order_id]);
    }

    const safeCustomerName = customer_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${safeCustomerName}-${bookingQuery.rows[0].order_id}.pdf`);
    fs.createReadStream(pdf).pipe(res);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch invoice', error: err.message });
  }
};