const express = require('express');
const router = express.Router();
const { 
  addGiftBoxProduct, 
  getGiftBoxProducts, 
  updateGiftBoxProduct, 
  deleteGiftBoxProduct, 
  toggleGiftBoxProductStatus, 
  toggleGiftBoxFastRunning,
  bookProduct 
} = require('../Controller/Inventory.controller');
const multer = require('multer');

const upload = multer({
  dest: './Uploads/',
});

router.post('/gift-box-products', upload.single('image'), addGiftBoxProduct);
router.get('/gift-box-products', getGiftBoxProducts);
router.put('/gift-box-products/:id', upload.single('image'), updateGiftBoxProduct);
router.delete('/gift-box-products/:id', deleteGiftBoxProduct);
router.patch('/gift-box-products/:id/toggle-status', toggleGiftBoxProductStatus);
router.patch('/gift-box-products/:id/toggle-fast-running', toggleGiftBoxFastRunning);
router.post('/gift-box-products/:id/book', bookProduct);

module.exports = router;