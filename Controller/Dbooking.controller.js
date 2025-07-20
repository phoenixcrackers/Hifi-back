const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
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
    fs.mkdirSync(pdfDir, { recursive: true });
    cb(null, pdfDir);
  },
  filename: (req, file, cb) => {
    const { customer_name, order_id } = req.body;
    const safeName = (customer_name || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    cb(null, `${safeName}-${order_id}.pdf`);
  },
});
const upload = multer({ storage });

const validateId = (id, type = 'id') => /^[a-zA-Z0-9-_]+$/.test(id) ? null : `Invalid ${type} format`;

const parseProducts = (products) => {
  try {
    return typeof products === 'string' ? JSON.parse(products) : products || [];
  } catch {
    return null;
  }
};

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

const generateInvoicePDF = (bookingData, customerDetails, products, extraCharges = {}) => {
  return new Promise((resolve, reject) => {
    if (!bookingData || !customerDetails || !Array.isArray(products)) {
      return reject(new Error('Invalid input: bookingData, customerDetails, and products required'));
    }

    const doc = new PDFDocument({ margin: 50 });
    const safeName = (customerDetails.customer_name || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const pdfPath = path.join(__dirname, '../pdf_data', `${safeName}-${bookingData.order_id || 'unknown'}.pdf`);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    doc.fontSize(20).font('Helvetica-Bold').text('Invoice', 50, 50, { align: 'center' });
    doc.fontSize(12).font('Helvetica')
      .text('Hifi Pyro Park', 50, 80, { align: 'center' })
      .text('Anil Kumar Eye Hospital Opp, Sattur Road, Sivakasi', 50, 95, { align: 'center' })
      .text('Mobile: +91 63836 59214', 50, 110, { align: 'center' })
      .text('Email: nivasramasamy27@gmail.com', 50, 125, { align: 'center' })
      .text(`Customer: ${customerDetails.customer_name || 'N/A'}`, 50, 160)
      .text(`Contact: ${customerDetails.mobile_number || 'N/A'}`, 50, 175)
      .text(`Address: ${customerDetails.address || 'N/A'}`, 50, 190)
      .text(`District: ${customerDetails.district || 'N/A'}`, 300, 160, { align: 'right' })
      .text(`State: ${customerDetails.state || 'N/A'}`, 300, 175, { align: 'right' })
      .text(`Customer Type: ${bookingData.customer_type || 'User'}`, 300, 190, { align: 'right' })
      .text(`Order ID: ${bookingData.order_id || 'N/A'}`, 300, 205, { align: 'right' });

    const tableY = 250, colWidths = [50, 150, 80, 80, 60, 80], colX = [50, 100, 250, 330, 410, 470];
    doc.moveTo(50, tableY - 5).lineTo(550, tableY - 5).stroke();
    drawTableRow(doc, tableY, colX, colWidths, ['Sl No', 'Product', 'Quantity', 'Price', 'Per', 'Total']);

    let y = tableY + 25, total = 0;
    products.forEach((product, index) => {
      const price = parseFloat(product.price) || 0;
      const discount = parseFloat(product.discount || 0);
      const productTotal = (price - (price * discount / 100)) * (product.quantity || 0);
      total += productTotal;
      drawTableRow(doc, y, colX, colWidths, [
        index + 1,
        product.productname || 'N/A',
        product.quantity || 0,
        `Rs.${price.toFixed(2)}`,
        product.per || 'N/A',
        `Rs.${productTotal.toFixed(2)}`,
      ]);
      y += 20;
    });

    y += 10;
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
      total = total + tax + pf - minus;
    }

    doc.font('Helvetica-Bold').text(`Grand Total: Rs.${total.toFixed(2)}`, 450, y, { align: 'right' });
    doc.end();
    stream.on('finish', () => resolve({ pdfPath, calculatedTotal: total }));
    stream.on('error', reject);
  });
};

exports.getAdmins = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, username, bank_name FROM public.admin');
    const admins = await Promise.all(rows.map(async admin => ({
      ...admin,
      total: (await pool.query('SELECT COALESCE(SUM(amount_paid), 0) as total FROM public.payment_transactions WHERE admin_id = $1', [admin.id])).rows[0].total,
    })));
    res.json(admins);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch admins', error: err.message });
  }
};

const generateReceiptPDF = (bookingData, customerDetails, products, dispatchLogs = [], payments = []) => {
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
      .text(`Address: ${customerDetails.address || 'N/A'}`, 50, 205)
      .text(`District: ${customerDetails.district || 'N/A'}`, 300, 160, { align: 'right' })
      .text(`State: ${customerDetails.state || 'N/A'}`, 300, 175, { align: 'right' })
      .text(`Order ID: ${bookingData.order_id || 'N/A'}`, 300, 190, { align: 'right' })
      .text(`Status: ${bookingData.status || 'N/A'}`, 300, 205, { align: 'right' });

    // Product Table
    let y = 250;
    const productColWidths = [50, 150, 80, 80, 60, 80];
    const productColX = [50, 100, 250, 330, 410, 470];
    doc.moveTo(50, y - 5).lineTo(550, y - 5).stroke();
    drawTableRow(doc, y, productColX, productColWidths, ['Sl No', 'Product', 'Quantity', 'Price', 'Per', 'Total']);

    y += 25;
    let productTotal = 0;
    products.forEach((product, index) => {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      const price = parseFloat(product.price) || 0;
      const discount = parseFloat(product.discount || 0);
      const productTotalValue = (price - (price * discount / 100)) * (product.quantity || 0);
      productTotal += productTotalValue;
      drawTableRow(doc, y, productColX, productColWidths, [
        index + 1,
        product.productname || 'N/A',
        product.quantity || 0,
        `Rs.${price.toFixed(0)}`,
        product.per || 'N/A',
        `Rs.${productTotalValue.toFixed(0)}`,
      ]);
      y += 20;
    });

    // Dispatch Logs Table
    y += 30;
    if (y > 700) {
      doc.addPage();
      y = 50;
    }
    doc.fontSize(14).font('Helvetica').text('Dispatch Logs', 50, y);
    y += 20;
    const dispatchColWidths = [50, 150, 80, 80, 150];
    const dispatchColX = [50, 100, 250, 330, 410];
    doc.moveTo(50, y - 5).lineTo(550, y - 5).stroke();
    drawTableRow(doc, y, dispatchColX, dispatchColWidths, ['Sl No', 'Product', 'Booked', 'Total Sent', 'Date']);

    y += 25;
    dispatchLogs.forEach((log, index) => {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      drawTableRow(doc, y, dispatchColX, dispatchColWidths, [
        index + 1,
        log.product_name || 'N/A',
        log.quantity || '0',
        log.dispatched_qty || '0',
        new Date(log.dispatched_at).toLocaleDateString() || 'N/A',
      ]);
      y += 20;
    });

    // Payments Table
    y += 30;
    if (y > 700) {
      doc.addPage();
      y = 50;
    }
    doc.fontSize(14).font('Helvetica').text('Payments', 50, y);
    y += 20;
    const paymentColWidths = [50, 150, 100, 100, 100];
    const paymentColX = [50, 100, 250, 350, 450];
    doc.moveTo(50, y - 5).lineTo(550, y - 5).stroke();
    drawTableRow(doc, y, paymentColX, paymentColWidths, ['Sl No', 'Admin Name', 'Type', 'Received', 'Date']);

    y += 25;
    let totalReceived = 0;
    payments.forEach((payment, index) => {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      const amount = parseFloat(payment.amount_paid) || 0;
      totalReceived += amount;
      drawTableRow(doc, y, paymentColX, paymentColWidths, [
        index + 1,
        payment.admin_username || 'N/A',
        payment.payment_method || 'N/A',
        `Rs.${amount.toFixed(0)}`,
        { text: new Date(payment.created_at).toLocaleDateString(), align: 'center' },
      ], { alignOptions: [null, null, null, null, 'center'] });
      y += 20;
    });

    // Total Received
    y += 20;
    if (y > 700) {
      doc.addPage();
      y = 50;
    }
    doc.font('Helvetica-Bold').text(`Total Received: Rs.${totalReceived.toFixed(0)}`, 450, y, { align: 'right' });

    doc.end();
    stream.on('finish', () => resolve({ pdfPath, calculatedTotal: totalReceived }));
    stream.on('error', reject);
  });
};

exports.getReceipt = async (req, res) => {
  try {
    let { order_id } = req.params;
    console.log(`Processing receipt for order_id: ${order_id}`);

    // Normalize order_id
    if (order_id.endsWith('.pdf')) {
      order_id = order_id.replace(/\.pdf$/, '');
    }

    // Validate order_id
    const validationError = validateId(order_id);
    if (validationError) {
      console.error(`Validation error: ${validationError}`);
      return res.status(400).json({ message: validationError });
    }

    // Fetch booking data
    console.log('Querying dbooking table...');
    let { rows } = await pool.query(
      'SELECT products, total, customer_name, address, mobile_number, email, district, state, customer_type, status, pdf, order_id, id FROM public.dbooking WHERE order_id = $1',
      [order_id]
    );

    if (!rows.length) {
      const possibleOrderId = order_id.split('-').slice(1).join('-');
      ({ rows } = await pool.query(
        'SELECT products, total, customer_name, address, mobile_number, email, district, state, customer_type, status, pdf, order_id, id FROM public.dbooking WHERE order_id = $1',
        [possibleOrderId]
      ));
    }

    if (!rows.length) {
      console.error(`No booking found for order_id: ${order_id} or ${possibleOrderId}`);
      return res.status(404).json({ message: `Receipt not found for order_id '${order_id}'` });
    }

    const { products, total, customer_name, address, mobile_number, email, district, state, customer_type, status, order_id: actualOrderId, id: booking_id } = rows[0];

    // Fetch dispatch logs
    console.log(`Querying dispatch_logs for order_id: ${actualOrderId}`);
    const { rows: dispatchLogs } = await pool.query(
      'SELECT product_name, quantity, dispatched_qty, dispatched_at FROM public.dispatch_logs WHERE order_id = $1 ORDER BY dispatched_at DESC',
      [actualOrderId]
    );

    // Fetch payment transactions
    const { rows: paymentRows } = await pool.query(
      `SELECT pt.amount_paid, pt.payment_method, pt.created_at, a.username AS admin_username 
       FROM public.payment_transactions pt 
       LEFT JOIN public.admin a ON pt.admin_id = a.id 
       WHERE pt.booking_id = $1 ORDER BY pt.id ASC`,
      [booking_id]
    );

    // Generate PDF path
    const safeName = customer_name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const pdfPath = path.join(__dirname, '../receipt', `${safeName}-${actualOrderId}-receipt.pdf`);

    // Check if PDF exists, regenerate if not
    if (!fs.existsSync(pdfPath)) {
      try {
        const parsedProducts = parseProducts(products);
        if (!parsedProducts) {
          console.error('Failed to parse products:', products);
          throw new Error('Invalid product data format');
        }
        await generateReceiptPDF(
          { order_id: actualOrderId, customer_type, total, status },
          { customer_name, address, mobile_number, email, district, state },
          parsedProducts,
          dispatchLogs,
          paymentRows
        );
      } catch (pdfError) {
        console.error('PDF generation failed:', pdfError.message);
        throw new Error(`Failed to generate receipt PDF: ${pdfError.message}`);
      }
    } else {
      console.log('PDF already exists, serving existing file');
    }

    // Serve the PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${safeName}-${actualOrderId}-receipt.pdf`);
    const stream = fs.createReadStream(pdfPath);
    stream.on('error', (streamError) => {
      console.error('Error reading PDF file:', streamError.message);
      res.status(500).json({ message: 'Failed to read receipt PDF', error: streamError.message });
    });
    stream.pipe(res);
    console.log('PDF streamed to client');
  } catch (err) {
    console.error('Error in getReceipt:', err.message, err.stack);
    res.status(500).json({ message: 'Failed to fetch receipt', error: err.message });
  }
};

exports.getAdminTransactions = async (req, res) => {
  try {
    const { adminId } = req.params;
    const { rows } = await pool.query(
      `SELECT pt.amount_paid, pt.payment_method, pt.transaction_date, d.customer_name 
       FROM public.payment_transactions pt 
       LEFT JOIN public.dbooking d ON pt.booking_id = d.id 
       WHERE pt.admin_id = $1 
       ORDER BY pt.transaction_date DESC`,
      [adminId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch transactions', error: err.message });
  }
};

exports.getBookings = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, order_id, customer_name, company_name, license_number, address, district, state, mobile_number, email, 
             products, status, created_at, pdf, remaining, admin, customer_type, customer_id, balance, amount_paid, 
             payment_date, amount_status, payment_method, admin_id, transaction_date, transport_type, transport_name, 
             transport_contact, lr_number, extra_charges, total, dispatched_qty
      FROM public.dbooking ORDER BY created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { rows } = await pool.query(
      'SELECT amount_paid, payment_method, admin_id, transaction_date FROM public.payment_transactions WHERE booking_id = $1 ORDER BY transaction_date DESC',
      [bookingId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch transactions', error: err.message });
  }
};

exports.updateBookingStatus = async (req, res) => {
  const { id } = req.params;
  const { status, dispatched_qty, transport_type, transport_name, transport_contact, lr_number, payment_method, amount_paid, admin_id } = req.body;

  try {
    if (validateId(id, 'booking ID')) return res.status(400).json({ error: validateId(id, 'booking ID') });

    const { rows } = await pool.query('SELECT products, dispatched_qty, total, amount_paid FROM public.dbooking WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Booking not found' });

    const booking = rows[0];
    const products = parseProducts(booking.products);
    if (!products) return res.status(400).json({ error: 'Invalid product data format' });

    let updateQuery = 'UPDATE public.dbooking SET status = $1';
    const updateValues = [status];
    let paramCount = 2;

    if (status === 'paid') {
      if (!['cash', 'bank'].includes(payment_method) || !amount_paid || parseFloat(amount_paid) <= 0 || !admin_id) {
        return res.status(400).json({ error: 'Invalid payment method, amount, or admin ID' });
      }
      const total = parseFloat(booking.total) || 0;
      const currentPaid = parseFloat(booking.amount_paid) || 0;
      if (parseFloat(amount_paid) > total - currentPaid) {
        return res.status(400).json({ error: 'Amount paid exceeds remaining balance' });
      }
      updateQuery += `, amount_paid = COALESCE(amount_paid, 0) + $${paramCount++}, payment_method = $${paramCount++}, admin_id = $${paramCount++}`;
      updateValues.push(parseFloat(amount_paid), payment_method, admin_id);
      await pool.query(
        'INSERT INTO public.payment_transactions (booking_id, amount_paid, payment_method, admin_id, transaction_date) VALUES ($1, $2, $3, $4, NOW())',
        [id, parseFloat(amount_paid), payment_method, admin_id]
      );
    } else if (['dispatched', 'delivered'].includes(status)) {
      const totalQty = products.reduce((sum, p) => sum + (parseInt(p.quantity) || 0), 0);
      const currentDispatched = parseInt(booking.dispatched_qty || 0);
      const newDispatchQty = parseInt(dispatched_qty || 0);
      if (!dispatched_qty || newDispatchQty <= 0 || currentDispatched + newDispatchQty > totalQty) {
        return res.status(400).json({ error: 'Invalid dispatch quantity' });
      }
      updateQuery += `, dispatched_qty = $${paramCount++}`;
      updateValues.push(currentDispatched + newDispatchQty);
      if (transport_type) {
        updateQuery += `, transport_type = $${paramCount++}`;
        updateValues.push(transport_type);
        if (transport_type === 'transport') {
          if (transport_name) updateQuery += `, transport_name = $${paramCount++}`, updateValues.push(transport_name);
          if (transport_contact) updateQuery += `, transport_contact = $${paramCount++}`, updateValues.push(transport_contact);
          if (lr_number) updateQuery += `, lr_number = $${paramCount++}`, updateValues.push(lr_number);
        }
      }
    } else {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    updateQuery += ` WHERE id = $${paramCount}`;
    updateValues.push(id);
    await pool.query(updateQuery, updateValues);
    res.json({ message: 'Booking status updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update booking status' });
  }
};

exports.updateBookingStatusByOrderId = async (req, res) => {
  const { order_id } = req.params;
  const { status = 'dispatched', products, transport_type, transport_name, transport_contact, lr_number } = req.body;

  // Define allowed statuses based on the check constraint
  const allowedStatuses = ['booked', 'paid', 'dispatched', 'delivered'];

  try {
    if (validateId(order_id)) return res.status(400).json({ error: validateId(order_id) });

    const { rows } = await pool.query('SELECT * FROM public.dbooking WHERE order_id = $1', [order_id]);
    if (!rows.length) return res.status(404).json({ message: 'Booking not found' });

    const booking = rows[0];
    const parsedProducts = parseProducts(booking.products);
    if (!parsedProducts) return res.status(400).json({ message: 'Invalid product data format' });

    // Validate input status
    if (!allowedStatuses.includes(status.toLowerCase())) {
      console.error('Invalid input status:', status);
      return res.status(400).json({ message: `Invalid status: ${status}. Must be one of ${allowedStatuses.join(', ')}` });
    }

    // Update dispatched quantities and validate totals
    products.forEach(({ index, dispatch_qty, total }) => {
      const parsedTotal = parseFloat(total);
      if (isNaN(parsedTotal) || parsedTotal < 0) {
        throw new Error(`Invalid total for product index ${index}`);
      }
      parsedProducts[index].dispatched = (parsedProducts[index].dispatched || 0) + dispatch_qty;
    });

    const totalDispatched = parsedProducts.reduce((sum, p) => sum + (p.dispatched || 0), 0);
    const totalQty = parsedProducts.reduce((sum, p) => sum + (parseInt(p.quantity) || 0), 0);

    // Log for debugging
    console.log('Input status:', status, 'Total Dispatched:', totalDispatched, 'Total Qty:', totalQty);

    // Use the input status (do not override with 'delivered' based on quantities)
    const newStatus = status.toLowerCase();

    // Ensure newStatus is valid
    if (!allowedStatuses.includes(newStatus)) {
      console.error('Computed status invalid:', newStatus);
      throw new Error(`Computed status '${newStatus}' is not allowed. Must be one of ${allowedStatuses.join(', ')}`);
    }

    await pool.query(
      `UPDATE public.dbooking SET 
        products = $1, dispatched_qty = $2, transport_type = $3, transport_name = $4, 
        transport_contact = $5, lr_number = $6, status = $7
      WHERE order_id = $8`,
      [
        JSON.stringify(parsedProducts),
        totalDispatched,
        transport_type || null,
        transport_name || null,
        transport_contact || null,
        lr_number || null,
        newStatus,
        order_id,
      ]
    );

    const insertPromises = products.map(({ index, dispatch_qty, total }) => {
      const product = parsedProducts[index];
      return pool.query(
        `INSERT INTO public.dispatch_logs (
          order_id, booking_id, customer_name, company_name, license_number, address, district, state, 
          mobile_number, email, product_index, product_name, quantity, dispatched_qty, admin, customer_type, 
          customer_id, amount_paid, balance, payment_method, payment_date, transaction_date, transport_type, 
          transport_name, transport_contact, lr_number, total
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)`,
        [
          booking.order_id,
          booking.id,
          booking.customer_name,
          booking.company_name,
          booking.license_number,
          booking.address,
          booking.district,
          booking.state,
          booking.mobile_number,
          booking.email,
          index,
          product.productname || `Product ${index}`,
          parseInt(product.quantity) || 0,
          dispatch_qty,
          booking.admin,
          booking.customer_type,
          booking.customer_id,
          booking.amount_paid,
          booking.balance,
          booking.payment_method,
          booking.payment_date,
          booking.transaction_date,
          transport_type || null,
          transport_name || null,
          transport_contact || null,
          lr_number || null,
          parseFloat(total) || 0.00,
        ]
      );
    });

    await Promise.all(insertPromises);
    res.json({ message: 'Dispatch updated and logged successfully' });
  } catch (err) {
    console.error('Error in updateBookingStatusByOrderId:', err.message);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
};

exports.getDispatchLogsByOrderId = async (req, res) => {
  const { order_id } = req.params;

  try {
    if (validateId(order_id)) return res.status(400).json({ message: validateId(order_id) });

    const { rows: dispatchLogs } = await pool.query(
      'SELECT * FROM public.dispatch_logs WHERE order_id = $1 ORDER BY dispatched_at DESC',
      [order_id]
    );

    let payments = [];
    if (dispatchLogs.length) {
      const { rows } = await pool.query(
        `SELECT pt.*, a.username AS admin_username 
         FROM public.payment_transactions pt 
         LEFT JOIN public.admin a ON pt.admin_id = a.id 
         WHERE pt.booking_id = $1 ORDER BY pt.id ASC`,
        [dispatchLogs[0].booking_id]
      );
      payments = rows;
    }

    res.json({ dispatch_logs: dispatchLogs, payments });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch data', error: err.message });
  }
};

exports.createBooking = async (req, res) => {
  const { customer_id, products, total, customer_type, customer_name, address, mobile_number, email, district, state, payment_method, amount_paid, admin_id } = req.body;
  const order_id = `ORD-${Date.now()}`;

  try {
    if (!products?.length || total <= 0) return res.status(400).json({ message: 'Valid products and total required' });
    if (payment_method && (!['cash', 'bank'].includes(payment_method) || !amount_paid || amount_paid <= 0 || !admin_id)) {
      return res.status(400).json({ message: 'Invalid payment details' });
    }

    let finalCustomerType = customer_type || 'User';
    let customerDetails = { customer_name, address, mobile_number, email, district, state };
    if (customer_id) {
      const { rows } = await pool.query(
        'SELECT customer_name, address, mobile_number, email, district, state, customer_type FROM public.gbcustomers WHERE id = $1',
        [customer_id]
      );
      if (!rows.length) return res.status(404).json({ message: 'Customer not found' });
      customerDetails = rows[0];
      finalCustomerType = customer_type || rows[0].customer_type || 'User';
    } else if (finalCustomerType !== 'User' || !customer_name || !address || !district || !state || !mobile_number || !email) {
      return res.status(400).json({ message: 'Complete customer details required for non-existing customers' });
    }

    for (const { id, product_type, quantity } of products) {
      if (!id || !product_type || quantity < 1) return res.status(400).json({ message: 'Invalid product data' });
      const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
      const { rows } = await pool.query(`SELECT id FROM public.${tableName} WHERE id = $1 AND status = 'on'`, [id]);
      if (!rows.length) return res.status(404).json({ message: `Product ${id} not found` });
    }

    const { pdfPath } = await generateInvoicePDF({ order_id, customer_type: finalCustomerType, total }, customerDetails, products);

    await pool.query('BEGIN');
    const { rows } = await pool.query(
      `INSERT INTO public.dbooking (customer_id, order_id, products, total, address, mobile_number, customer_name, email, district, state, customer_type, status, created_at, pdf, payment_method, amount_paid, admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'booked', NOW(), $12, $13, $14, $15) RETURNING id, created_at, customer_type, pdf, order_id`,
      [customer_id || null, order_id, JSON.stringify(products), parseFloat(total), customerDetails.address || null, customerDetails.mobile_number || null, 
       customerDetails.customer_name || null, customerDetails.email || null, customerDetails.district || null, customerDetails.state || null, 
       finalCustomerType, pdfPath, payment_method || null, parseFloat(amount_paid) || 0, admin_id || null]
    );

    if (payment_method && amount_paid) {
      await pool.query(
        'INSERT INTO public.payment_transactions (booking_id, amount_paid, payment_method, admin_id, transaction_date) VALUES ($1, $2, $3, $4, NOW())',
        [rows[0].id, parseFloat(amount_paid), payment_method, admin_id]
      );
    }

    await pool.query('COMMIT');
    res.status(201).json({ message: 'Booking created successfully', ...rows[0] });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ message: 'Failed to create booking', error: err.message });
  }
};

exports.getInvoice = async (req, res) => {
  try {
    let { order_id } = req.params;
    if (order_id.endsWith('.pdf')) order_id = order_id.replace(/\.pdf$/, '');
    if (validateId(order_id)) return res.status(400).json({ message: validateId(order_id) });

    let { rows } = await pool.query(
      'SELECT products, total, customer_name, address, mobile_number, email, district, state, customer_type, pdf, order_id FROM public.dbooking WHERE order_id = $1',
      [order_id]
    );

    if (!rows.length) {
      const possibleOrderId = order_id.split('-').slice(1).join('-');
      ({ rows } = await pool.query(
        'SELECT products, total, customer_name, address, mobile_number, email, district, state, customer_type, pdf, order_id FROM public.dbooking WHERE order_id = $1',
        [possibleOrderId]
      ));
    }

    if (!rows.length) return res.status(404).json({ message: `Invoice not found for order_id '${order_id}'` });

    const { products, total, customer_name, address, mobile_number, email, district, state, customer_type, pdf, order_id: actualOrderId } = rows[0];
    if (!fs.existsSync(pdf)) {
      const { pdfPath } = await generateInvoicePDF({ order_id: actualOrderId, customer_type, total }, { customer_name, address, mobile_number, email, district, state }, JSON.parse(products));
      await pool.query('UPDATE public.dbooking SET pdf = $1 WHERE order_id = $2', [pdfPath, actualOrderId]);
    }

    const safeName = customer_name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${safeName}-${actualOrderId}.pdf`);
    fs.createReadStream(pdf).pipe(res);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch invoice', error: err.message });
  }
};

exports.getProducts = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, serial_number, productname, price, per, discount, stock, image, status FROM public.gift_box_dealers WHERE status = \'on\' AND stock > 0');
    res.json(rows.map(row => ({ ...row, product_type: 'gift_box_dealers' })));
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch products' });
  }
};

exports.bookProduct = async (req, res) => {
  try {
    const { tableName, id } = req.params;
    const { quantity } = req.body;

    if (tableName !== 'gift_box_dealers' || !quantity || quantity <= 0) {
      return res.status(400).json({ message: 'Invalid table name or quantity' });
    }

    const { rows } = await pool.query('SELECT stock FROM public.gift_box_dealers WHERE id = $1', [id]);
    if (!rows.length || quantity > rows[0].stock) {
      return res.status(404).json({ message: rows.length ? 'Insufficient stock' : 'Product not found' });
    }

    await pool.query('UPDATE public.gift_box_dealers SET stock = $1 WHERE id = $2', [rows[0].stock - quantity, id]);
    res.json({ message: 'Product booked successfully', newStock: rows[0].stock - quantity });
  } catch (err) {
    res.status(500).json({ message: 'Failed to book product' });
  }
};