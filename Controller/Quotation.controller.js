const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
});

const generateQuotationPDF = (quotationData, customerDetails, products, extraCharges = {}) => {
  return new Promise((resolve, reject) => {
    // Input validation
    if (!quotationData || !customerDetails || !Array.isArray(products)) {
      return reject(new Error('Invalid input: quotationData, customerDetails, and products are required'));
    }

    const doc = new PDFDocument({ margin: 50 });
    const safeCustomerName = (customerDetails.customer_name || 'unknown')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const pdfPath = path.join(__dirname, '../quotation', `${safeCustomerName}-${quotationData.est_id || 'unknown'}.pdf`);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('Quotation', 50, 50, { align: 'center' });
    doc.fontSize(12).font('Helvetica')
      .text('Hifi Pyro Park', 50, 80, {align:'center'})
      .text('Anil Kumar Eye Hospital Opp, Sattur Road, Sivakasi', 50, 95, {align:'center'})
      .text('Mobile: +91 63836 59214', 50, 110, {align:'center'})
      .text('Email: nivasramasamy27@gmail.com', 50, 125, {align:'center'});

    // Customer Details (Left and Right)
    doc.fontSize(12).font('Helvetica')
      .text(`Customer: ${customerDetails.customer_name || 'N/A'}`, 50, 160)
      .text(`Contact: ${customerDetails.mobile_number || 'N/A'}`, 50, 175)
      .text(`Address: ${customerDetails.address || 'N/A'}`, 50, 190)
      .text(`District: ${customerDetails.district || 'N/A'}`, 300, 160, { align: 'right' })
      .text(`State: ${customerDetails.state || 'N/A'}`, 300, 175, { align: 'right' })
      .text(`Customer Type: ${quotationData.customer_type || 'User'}`, 300, 190, { align: 'right' })
      .text(`Quotation ID: ${quotationData.est_id || 'N/A'}`, 300, 205, { align: 'right' });

    // Table Header
    const tableY = 250;
    const tableWidth = 500;
    const colWidths = [50, 150, 80, 80, 60, 80]; // Sl No, Product, Quantity, Price, Per, Total
    const colX = [50, 100, 250, 330, 410, 470]; // X positions for columns

    // Draw table top border
    doc.moveTo(50, tableY - 5).lineTo(50 + tableWidth, tableY - 5).stroke();

    // Table Header
    doc.fontSize(10).font('Helvetica-Bold')
      .text('Sl No', colX[0] + 5, tableY, { width: colWidths[0] - 10, align: 'center' })
      .text('Product', colX[1] + 5, tableY, { width: colWidths[1] - 10, align: 'center' })
      .text('Quantity', colX[2] + 5, tableY, { width: colWidths[2] - 10, align: 'center' })
      .text('Price', colX[3] + 5, tableY, { width: colWidths[3] - 10, align: 'center' })
      .text('Per', colX[4] + 5, tableY, { width: colWidths[4] - 10, align: 'center' })
      .text('Total', colX[5] + 5, tableY, { width: colWidths[5] - 10, align: 'center' });

    // Draw header bottom border
    doc.moveTo(50, tableY + 15).lineTo(50 + tableWidth, tableY + 15).stroke();

    // Draw vertical lines for header
    colX.forEach((x, i) => {
      doc.moveTo(x, tableY - 5).lineTo(x, tableY + 15).stroke();
      if (i === colX.length - 1) {
        doc.moveTo(x + colWidths[i], tableY - 5).lineTo(x + colWidths[i], tableY + 15).stroke();
      }
    });

    // Table Rows
    let y = tableY + 25;
    let calculatedTotal = 0;
    products.forEach((product, index) => {
      const price = parseFloat(product.price) || 0;
      const discount = parseFloat(product.discount || 0);
      const productTotal = (price - (price * discount / 100)) * (product.quantity || 0);
      calculatedTotal += productTotal;

      // Draw row content
      doc.font('Helvetica')
        .text(index + 1, colX[0] + 5, y, { width: colWidths[0] - 10, align: 'center' })
        .text(product.productname || 'N/A', colX[1] + 5, y, { width: colWidths[1] - 10, align: 'center' })
        .text(product.quantity || 0, colX[2] + 5, y, { width: colWidths[2] - 10, align: 'center' })
        .text(`Rs.${price.toFixed(2)}`, colX[3] + 5, y, { width: colWidths[3] - 10, align: 'center' })
        .text(product.per || 'N/A', colX[4] + 5, y, { width: colWidths[4] - 10, align: 'center' })
        .text(`Rs.${productTotal.toFixed(2)}`, colX[5] + 5, y, { width: colWidths[5] - 10, align: 'center' });

      // Draw row bottom border
      doc.moveTo(50, y + 15).lineTo(50 + tableWidth, y + 15).stroke();

      // Draw vertical lines for row
      colX.forEach((x, i) => {
        doc.moveTo(x, y - 5).lineTo(x, y + 15).stroke();
        if (i === colX.length - 1) {
          doc.moveTo(x + colWidths[i], y - 5).lineTo(x + colWidths[i], y + 15).stroke();
        }
      });

      y += 20;
    });

    // Extra Charges (only if present)
    y += 10;
    const tax = parseFloat(extraCharges.tax || 0);
    const pf = parseFloat(extraCharges.pf || 0);
    const minus = parseFloat(extraCharges.minus || 0);
    if (tax > 0 || pf > 0 || minus > 0) {
      let extraChargesText = '';
      if (tax > 0) extraChargesText += `Tax: Rs.${tax.toFixed(2)}  `;
      if (pf > 0) extraChargesText += `P&F: Rs.${pf.toFixed(2)}  `;
      if (minus > 0) extraChargesText += `Deduction: -Rs.${minus.toFixed(2)}  `;
      doc.font('Helvetica').text(extraChargesText.trim(), 400, y, { align: 'right' });
      y += 20;
      calculatedTotal = calculatedTotal + tax + pf - minus;
    }

    // Grand Total
    doc.font('Helvetica-Bold').text(`Grand Total: Rs.${calculatedTotal.toFixed(2)}`, 450, y, { align: 'right' });

    doc.end();
    stream.on('finish', () => resolve({ pdfPath, calculatedTotal }));
    stream.on('error', (err) => reject(err));
  });
};

const generateInvoicePDF = (bookingData, customerDetails, products, extraCharges = {}) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const safeCustomerName = customerDetails.customer_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const pdfPath = path.join(__dirname, '../pdf_data', `${safeCustomerName}-${bookingData.order_id}.pdf`);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('Invoice', 50, 50, { align: 'center' });
    doc.fontSize(12).font('Helvetica')
      .text('Hifi Pyro Park', 50, 80, {align:'center'})
      .text('Anil Kumar Eye Hospital Opp, Sattur Road, Sivakasi', 50, 95, {align:'center'})
      .text('Mobile: +91 63836 59214', 50, 110, {align:'center'})
      .text('Email: nivasramasamy27@gmail.com', 50, 125, {align:'center'});

    // Customer Details (Left and Right)
    doc.fontSize(12).font('Helvetica')
      .text(`Customer: ${customerDetails.customer_name || 'N/A'}`, 50, 160)
      .text(`Contact: ${customerDetails.mobile_number || 'N/A'}`, 50, 175)
      .text(`Address: ${customerDetails.address || 'N/A'}`, 50, 190)
      .text(`District: ${customerDetails.district || 'N/A'}`, 300, 160, { align: 'right' })
      .text(`State: ${customerDetails.state || 'N/A'}`, 300, 175, { align: 'right' })
      .text(`Customer Type: ${bookingData.customer_type || 'User'}`, 300, 190, { align: 'right' })
      .text(`Order ID: ${bookingData.order_id}`, 300, 205, { align: 'right' });

    // Table Header
    const tableY = 250;
    const tableWidth = 500;
    const colWidths = [200, 100, 100, 100]; // Product, Quantity, Price, Total
    const colX = [50, 250, 350, 450]; // X positions for columns

    // Draw table top border
    doc.moveTo(50, tableY - 5).lineTo(50 + tableWidth, tableY - 5).stroke();

    // Table Header
    doc.fontSize(10).font('Helvetica-Bold')
      .text('Product', colX[0] + 5, tableY)
      .text('Quantity', colX[1] + 5, tableY)
      .text('Price', colX[2] + 5, tableY)
      .text('Total', colX[3] + 5, tableY);

    // Draw header bottom border
    doc.moveTo(50, tableY + 15).lineTo(50 + tableWidth, tableY + 15).stroke();

    // Draw vertical lines for header
    colX.forEach((x, i) => {
      doc.moveTo(x, tableY - 5).lineTo(x, tableY + 15).stroke();
      if (i === colX.length - 1) {
        doc.moveTo(x + colWidths[i], tableY - 5).lineTo(x + colWidths[i], tableY + 15).stroke();
      }
    });

    // Table Rows
    let y = tableY + 25;
    let total = 0;
    products.forEach((product, index) => {
      const price = parseFloat(product.price);
      const discount = parseFloat(product.discount || 0);
      const productTotal = (price - (price * discount / 100)) * product.quantity;
      total += productTotal;

      // Draw row content
      doc.font('Helvetica')
        .text(product.productname, colX[0] + 5, y, { width: colWidths[0] - 10, align: 'left' })
        .text(product.quantity, colX[1] + 5, y, { width: colWidths[1] - 10, align: 'left' })
        .text(`Rs.${price.toFixed(2)}`, colX[2] + 5, y, { width: colWidths[2] - 10, align: 'left' })
        .text(`Rs.${productTotal.toFixed(2)}`, colX[3] + 5, y, { width: colWidths[3] - 10, align: 'left' });

      // Draw row bottom border
      doc.moveTo(50, y + 15).lineTo(50 + tableWidth, y + 15).stroke();

      // Draw vertical lines for row
      colX.forEach((x, i) => {
        doc.moveTo(x, y - 5).lineTo(x, y + 15).stroke();
        if (i === colX.length - 1) {
          doc.moveTo(x + colWidths[i], y - 5).lineTo(x + colWidths[i], y + 15).stroke();
        }
      });

      y += 20;
    });

    // Extra Charges
    y += 10;
    const tax = parseFloat(extraCharges.tax || 0);
    const pf = parseFloat(extraCharges.pf || 0);
    const minus = parseFloat(extraCharges.minus || 0);
    let extraChargesText = '';
    if (tax > 0) extraChargesText += `Tax: Rs.${tax.toFixed(2)}  `;
    if (pf > 0) extraChargesText += `P&F: Rs.${pf.toFixed(2)}  `;
    if (minus > 0) extraChargesText += `Deduction: -Rs.${minus.toFixed(2)}  `;
    if (extraChargesText) {
      doc.font('Helvetica').text(extraChargesText.trim(), 50, y);
      y += 20;
    }

    // Grand Total
    total = total + tax + pf - minus;
    doc.font('Helvetica-Bold').text(`Grand Total: Rs.${total.toFixed(2)}`, 450, y, { align: 'right' });

    doc.end();
    stream.on('finish', () => resolve({ pdfPath, calculatedTotal: total }));
    stream.on('error', (err) => reject(err));
  });
};

exports.createQuotation = async (req, res) => {
  try {
    const { customer_id, products, total, customer_type, customer_name, address, mobile_number, email, district, state, extra_charges } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'Products array is required and must not be empty' });
    }
    if (!total || total <= 0) return res.status(400).json({ message: 'Total must be a positive number' });

    let finalCustomerType = customer_type || 'User';
    let customerDetails = { customer_name, address, mobile_number, email, district, state };

    if (customer_id) {
      const customerCheck = await pool.query(
        'SELECT id, customer_name, address, mobile_number, email, district, state, customer_type FROM public.gbcustomers WHERE id = $1',
        [customer_id]
      );
      if (customerCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Customer not found' });
      }
      const { customer_name: db_name, address: db_address, mobile_number: db_mobile, email: db_email, district: db_district, state: db_state, customer_type: dbCustomerType } = customerCheck.rows[0];
      finalCustomerType = customer_type || dbCustomerType || 'User';
      customerDetails = { customer_name: db_name, address: db_address, mobile_number: db_mobile, email: db_email, district: db_district, state: db_state };
    } else {
      if (finalCustomerType !== 'User') {
        return res.status(400).json({ message: 'Customer type must be "User" for quotations without customer ID' });
      }
      if (!customer_name) return res.status(400).json({ message: 'Customer name is required' });
      if (!address) return res.status(400).json({ message: 'Address is required' });
      if (!district) return res.status(400).json({ message: 'District is required' });
      if (!state) return res.status(400).json({ message: 'State is required' });
      if (!mobile_number) return res.status(400).json({ message: 'Mobile number is required' });
      if (!email) return res.status(400).json({ message: 'Email is required' });
    }

    for (const product of products) {
      const { id, product_type, quantity } = product;
      if (!id || !product_type || !quantity || quantity < 1) {
        return res.status(400).json({ message: 'Each product must have a valid ID, product type, and positive quantity' });
      }
      const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
      const productCheck = await pool.query(
        `SELECT id FROM public.${tableName} WHERE id = $1 AND status = 'on'`,
        [id]
      );
      if (productCheck.rows.length === 0) {
        return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or not available` });
      }
    }

    const est_id = `EST-${Date.now()}`;
    const { pdfPath, calculatedTotal } = await generateQuotationPDF(
      { est_id, customer_type: finalCustomerType, total },
      customerDetails,
      products,
      extra_charges || {}
    );

    const query = `
      INSERT INTO public.quotations (customer_id, est_id, products, total, address, mobile_number, customer_name, email, district, state, customer_type, status, created_at, pdf, extra_charges)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14)
      RETURNING id, created_at, customer_type, pdf, est_id
    `;
    const values = [
      customer_id || null,
      est_id,
      JSON.stringify(products),
      calculatedTotal,
      customerDetails.address || null,
      customerDetails.mobile_number || null,
      customerDetails.customer_name || null,
      customerDetails.email || null,
      customerDetails.district || null,
      customerDetails.state || null,
      finalCustomerType,
      'pending',
      pdfPath,
      JSON.stringify(extra_charges || {})
    ];
    const result = await pool.query(query, values);

    res.status(201).json({
      message: 'Quotation created successfully',
      id: result.rows[0].id,
      created_at: result.rows[0].created_at,
      customer_type: result.rows[0].customer_type,
      pdf_path: result.rows[0].pdf,
      est_id: result.rows[0].est_id
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to create quotation', error: err.message });
  }
};

exports.editQuotation = async (req, res) => {
  try {
    const { est_id } = req.params;
    const { products, total, extra_charges } = req.body;

    if (!est_id || !est_id.startsWith('EST') || !/^[a-zA-Z0-9-_]+$/.test(est_id.slice(4))) {
      return res.status(400).json({ message: 'Valid est_id starting with "EST" is required' });
    }

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'Products array is required and must not be empty' });
    }
    if (!total || total <= 0) return res.status(400).json({ message: 'Total must be a positive number' });

    const quotationQuery = await pool.query(
      'SELECT customer_id, customer_name, address, mobile_number, email, district, state, customer_type, status, products FROM public.quotations WHERE est_id = $1',
      [est_id]
    );

    if (quotationQuery.rows.length === 0) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    if (quotationQuery.rows[0].status !== 'pending') {
      return res.status(400).json({ message: 'Quotation is not in pending status' });
    }

    const { customer_id, customer_name, address, mobile_number, email, district, state, customer_type } = quotationQuery.rows[0];

    for (const product of products) {
      const { id, product_type, quantity } = product;
      if (!id || !product_type || !quantity || quantity < 1) {
        return res.status(400).json({ message: 'Each product must have a valid ID, product type, and positive quantity' });
      }
      const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
      const productCheck = await pool.query(
        `SELECT id FROM public.${tableName} WHERE id = $1 AND status = 'on'`,
        [id]
      );
      if (productCheck.rows.length === 0) {
        return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or not available` });
      }
    }

    const { pdfPath, calculatedTotal } = await generateQuotationPDF(
      { est_id, customer_type, total },
      { customer_name, address, mobile_number, email, district, state },
      products,
      extra_charges || {}
    );

    const query = `
      UPDATE public.quotations
      SET products = $1, total = $2, pdf = $3, extra_charges = $4
      WHERE est_id = $5
      RETURNING id, created_at, customer_type, pdf, est_id
    `;
    const values = [
      JSON.stringify(products),
      calculatedTotal,
      pdfPath,
      JSON.stringify(extra_charges || {}),
      est_id
    ];
    const result = await pool.query(query, values);

    res.status(200).json({
      message: 'Quotation updated successfully',
      id: result.rows[0].id,
      created_at: result.rows[0].created_at,
      customer_type: result.rows[0].customer_type,
      pdf_path: result.rows[0].pdf,
      est_id: result.rows[0].est_id
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update quotation', error: err.message });
  }
};

exports.getQuotations = async (req, res) => {
  try {
    const query = `
      SELECT *
      FROM public.quotations
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch quotations', error: err.message });
  }
};

exports.getQuotation = async (req, res) => {
  try {
    let { est_id } = req.params;

    if (est_id.endsWith('.pdf')) {
      est_id = est_id.replace(/\.pdf$/, '');
    }

    if (!est_id.startsWith('EST') || !/^[a-zA-Z0-9-_]+$/.test(est_id.slice(4))) {
      return res.status(400).json({ 
        message: 'Invalid est_id format', 
        details: 'Quotation ID must start with "EST" followed by alphanumeric characters, hyphens, or underscores' 
      });
    }

    let quotationQuery = await pool.query(
      'SELECT products, COALESCE(total, 0) AS total, customer_name, address, mobile_number, email, district, state, customer_type, pdf, est_id, extra_charges FROM public.quotations WHERE est_id = $1',
      [est_id]
    );

    if (quotationQuery.rows.length === 0) {
      const parts = est_id.split('-');
      if (parts.length > 1 && parts[0] === 'EST') {
        const possibleEstId = parts.slice(1).join('-');
        quotationQuery = await pool.query(
          'SELECT products, COALESCE(total, 0) AS total, customer_name, address, mobile_number, email, district, state, customer_type, pdf, est_id, extra_charges FROM public.quotations WHERE est_id = $1',
          [`EST-${possibleEstId}`]
        );
      }
    }

    if (quotationQuery.rows.length === 0) {
      return res.status(404).json({ 
        message: 'Quotation not found', 
        details: `No quotation found for est_id '${est_id}'. Please use an est_id starting with 'EST' (e.g., 'EST-1751548161837').`
      });
    }

    const { products, total, customer_name, address, mobile_number, email, district, state, customer_type, pdf, est_id: foundEstId, extra_charges } = quotationQuery.rows[0];

    if (!fs.existsSync(pdf)) {
      const regeneratedPdfPath = await generateQuotationPDF(
        { est_id: foundEstId, customer_type, total },
        { customer_name, address, mobile_number, email, district, state },
        JSON.parse(products),
        extra_charges || {}
      );
      await pool.query('UPDATE public.quotations SET pdf = $1 WHERE est_id = $2', [regeneratedPdfPath.pdfPath, foundEstId]);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${customer_name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}-${foundEstId}.pdf`);
    fs.createReadStream(pdf).pipe(res);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch quotation', error: err.message });
  }
};

exports.bookQuotation = async (req, res) => {
  try {
    const { est_id, customer_id, products, total, customer_type, customer_name, address, mobile_number, email, district, state, extra_charges } = req.body;

    if (!est_id || !est_id.startsWith('EST') || !/^[a-zA-Z0-9-_]+$/.test(est_id.slice(4))) {
      return res.status(400).json({ message: 'Valid est_id starting with "EST" is required' });
    }

    const quotationQuery = await pool.query(
      'SELECT customer_id, products, total, customer_name, address, mobile_number, email, district, state, customer_type, status, extra_charges FROM public.quotations WHERE est_id = $1',
      [est_id]
    );

    if (quotationQuery.rows.length === 0) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    if (quotationQuery.rows[0].status !== 'pending') {
      return res.status(400).json({ message: 'Quotation is not in pending status' });
    }

    const {
      customer_id: db_customer_id,
      products: db_products,
      total: db_total,
      customer_name: db_customer_name,
      address: db_address,
      mobile_number: db_mobile_number,
      email: db_email,
      district: db_district,
      state: db_state,
      customer_type: db_customer_type,
      extra_charges: db_extra_charges
    } = quotationQuery.rows[0];

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'Products array is required and must not be empty' });
    }
    if (!total || total <= 0) return res.status(400).json({ message: 'Total must be a positive number' });

    let finalCustomerType = customer_type || db_customer_type || 'User';
    let customerDetails = {
      customer_name: customer_name || db_customer_name,
      address: address || db_address,
      mobile_number: mobile_number || db_mobile_number,
      email: email || db_email,
      district: district || db_district,
      state: state || db_state
    };

    let finalCustomerId = customer_id || db_customer_id;

    if (finalCustomerId) {
      const customerCheck = await pool.query(
        'SELECT id, customer_name, address, mobile_number, email, district, state, customer_type FROM public.gbcustomers WHERE id = $1',
        [finalCustomerId]
      );
      if (customerCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Customer not found' });
      }
      const { customer_name, address, mobile_number, email, district, state, customer_type } = customerCheck.rows[0];
      finalCustomerType = customer_type || finalCustomerType;
      customerDetails = { customer_name, address, mobile_number, email, district, state };
    } else {
      if (finalCustomerType !== 'User') {
        return res.status(400).json({ message: 'Customer type must be "User" for bookings without customer ID' });
      }
      if (!customerDetails.customer_name) return res.status(400).json({ message: 'Customer name is required' });
      if (!customerDetails.address) return res.status(400).json({ message: 'Address is required' });
      if (!customerDetails.district) return res.status(400).json({ message: 'District is required' });
      if (!customerDetails.state) return res.status(400).json({ message: 'State is required' });
      if (!customerDetails.mobile_number) return res.status(400).json({ message: 'Mobile number is required' });
      if (!customerDetails.email) return res.status(400).json({ message: 'Email is required' });
    }

    for (const product of products) {
      const { id, product_type, quantity } = product;
      if (!id || !product_type || !quantity || quantity < 1) {
        return res.status(400).json({ message: 'Each product must have a valid ID, product type, and positive quantity' });
      }
      const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
      const productCheck = await pool.query(
        `SELECT id FROM public.${tableName} WHERE id = $1 AND status = 'on'`,
        [id]
      );
      if (productCheck.rows.length === 0) {
        return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or not available` });
      }
    }

    const order_id = est_id.replace(/^EST/, 'DORD');
    if (!order_id.startsWith('DORD') || !/^[a-zA-Z0-9-_]+$/.test(order_id.slice(4))) {
      return res.status(400).json({ message: 'Order ID must start with "DORD" followed by alphanumeric characters, hyphens, or underscores' });
    }

    const pdfPath = await generateInvoicePDF(
      { order_id, customer_type: finalCustomerType, total },
      customerDetails,
      products,
      extra_charges || db_extra_charges || {}
    );

    const query = `
      INSERT INTO public.dbooking (customer_id, order_id, products, total, address, mobile_number, customer_name, email, district, state, customer_type, status, created_at, pdf, extra_charges)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14)
      RETURNING id, created_at, customer_type, pdf, order_id
    `;
    const values = [
      finalCustomerId || null,
      order_id,
      JSON.stringify(products),
      parseFloat(total),
      customerDetails.address || null,
      customerDetails.mobile_number || null,
      customerDetails.customer_name || null,
      customerDetails.email || null,
      customerDetails.district || null,
      customerDetails.state || null,
      finalCustomerType,
      'booked',
      pdfPath,
      JSON.stringify(extra_charges || {})
    ];
    const result = await pool.query(query, values);

    await pool.query('UPDATE public.quotations SET status = $1 WHERE est_id = $2', ['booked', est_id]);

    res.status(201).json({
      message: 'Booking created successfully',
      id: result.rows[0].id,
      created_at: result.rows[0].created_at,
      customer_type: result.rows[0].customer_type,
      pdf_path: result.rows[0].pdf,
      order_id: result.rows[0].order_id
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to create booking', error: err.message });
  }
};

exports.cancelQuotation = async (req, res) => {
  try {
    const { est_id } = req.params;

    const quotationQuery = await pool.query(
      'SELECT id FROM public.quotations WHERE est_id = $1 AND status = $2',
      [est_id, 'pending']
    );

    if (quotationQuery.rows.length === 0) {
      return res.status(404).json({ message: 'Quotation not found or already processed' });
    }

    await pool.query('UPDATE public.quotations SET status = $1 WHERE est_id = $2', ['canceled', est_id]);

    res.status(200).json({ message: 'Quotation canceled successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to cancel quotation', error: err.message });
  }
};