module.exports = (dbModel, sessionDoc, req) =>
  new Promise(async (resolve, reject) => {

    switch (req.method.toUpperCase()) {
      case 'GET':
        if (req.params.param1 != undefined) {
          getOne(dbModel, sessionDoc, req).then(resolve).catch(reject)
        } else {
          getList(dbModel, sessionDoc, req).then(resolve).catch(reject)
        }
        break
      case 'POST':
        post(dbModel, sessionDoc, req).then(resolve).catch(reject)
        break
      case 'PUT':
        put(dbModel, sessionDoc, req).then(resolve).catch(reject)
        break
      case 'DELETE':
        deleteItem(dbModel, sessionDoc, req).then(resolve).catch(reject)
        break
      default:
        restError.method(req, reject)
        break
    }
  })

function getOne(dbModel, sessionDoc, req) {
  return new Promise((resolve, reject) => {
    dbModel.inventory
      .findOne({ _id: req.params.param1 })
      .then(resolve)
      .catch(reject)
  })
}

function getList(dbModel, sessionDoc, req) {
  return new Promise((resolve, reject) => {
    let options = {
      page: req.query.page || 1,
      limit: req.query.pageSize || 10,
      populate: [{
        path: 'item',
        populate: ['itemType', 'itemQuality']
      }]
    }
    let filter = {}
    if (req.query.despatch)
      filter.despatch = req.query.despatch

    if (req.query.ioType)
      filter.ioType = req.query.ioType

    if (req.query.startDate && req.query.endDate) {
      filter.issueDate = { $gte: req.query.startDate, $lte: req.query.endDate }
    } else if (req.query.startDate && !req.query.endDate) {
      filter.issueDate = { $gte: req.query.startDate }
    } else if (!req.query.startDate && req.query.endDate) {
      filter.issueDate = { $lte: req.query.endDate }
    }


    // if (req.query.search) {
    //   filter.$or = [
    //     { documentNumber: { $regex: `.*${req.query.search}.*`, $options: 'i' } },
    //     { 'address.streetName': { $regex: `.*${req.query.search}.*`, $options: 'i' } },
    //     { 'address.buildingName': { $regex: `.*${req.query.search}.*`, $options: 'i' } },
    //     { 'address.citySubdivisionName': { $regex: `.*${req.query.search}.*`, $options: 'i' } },
    //     { 'address.cityName': { $regex: `.*${req.query.search}.*`, $options: 'i' } },
    //     { 'address.region': { $regex: `.*${req.query.search}.*`, $options: 'i' } },
    //     { 'address.district': { $regex: `.*${req.query.search}.*`, $options: 'i' } },
    //     { 'address.country.name': { $regex: `.*${req.query.search}.*`, $options: 'i' } },
    //   ]
    // }

    dbModel.inventory
      .paginate(filter, options)
      .then(resolve).catch(reject)
  })
}

function post(dbModel, sessionDoc, req) {
  return new Promise(async (resolve, reject) => {
    try {

      let data = req.body || {}
      delete data._id
      if (!data.despatch) return reject('despatch required')
      if (!data.item) return reject('item required')
      if ((data.quantity || 0) <= 0) return reject('quantity must be greater than zero')
      if ((data.price || 0) < 0) return reject('price must be greater or equal to zero')

      let despatchDoc = await dbModel.despatches.findOne({ _id: data.despatch })
      if (!despatchDoc) return reject(`despatch not found`)

      let itemDoc = await dbModel.items.findOne({ _id: data.item })
      if (!itemDoc) return reject(`item not found`)

      data.ioType = despatchDoc.ioType
      data.issueDate = despatchDoc.issueDate
      data.issueTime = despatchDoc.issueTime
      data.currency = despatchDoc.currency

      const doc = new dbModel.inventory(data)
      doc.total = Math.round(100 * (doc.price || 0) * doc.quantity) / 100
      doc.taxAmount = Math.round(100 * doc.total * (doc.taxRate || 0) / 100) / 100
      doc.withHoldingTaxAmount = Math.round(100 * doc.taxAmount * (doc.withHoldingTaxRate || 0)) / 100
      doc.taxInclusiveTotal = Math.round(100 * (doc.total + doc.taxAmount - doc.withHoldingTaxAmount)) / 100

      if (!epValidateSync(doc, reject)) return

      doc.save()
        .then(async newDoc => {
          await updateDespatch(dbModel, newDoc.despatch)
          let obj = await newDoc.populate([{
            path: 'item',
            populate: ['itemType', 'itemQuality']
          }])
          resolve(obj)
        })
        .catch(reject)
    } catch (err) {
      reject(err)
    }

  })
}

function put(dbModel, sessionDoc, req) {
  return new Promise(async (resolve, reject) => {
    try {

      if (req.params.param1 == undefined) return restError.param1(req, reject)
      let data = req.body || {}
      delete data._id
      delete data.despatch
      if (!data.item) return reject('item required')
      if ((data.quantity || 0) <= 0) return reject('quantity must be greater than zero')
      if ((data.price || 0) < 0) return reject('price must be greater or equal to zero')

      let doc = await dbModel.inventory.findOne({ _id: req.params.param1 })
      if (!doc) return reject(`record not found`)

      let despatchDoc = await dbModel.despatches.findOne({ _id: doc.despatch })
      if (!despatchDoc) return reject(`despatch not found`)

      let itemDoc = await dbModel.items.findOne({ _id: data.item })
      if (!itemDoc) return reject(`item not found`)



      doc = Object.assign(doc, data)
      doc.ioType = despatchDoc.ioType
      doc.issueDate = despatchDoc.issueDate
      doc.issueTime = despatchDoc.issueTime
      doc.currency = despatchDoc.currency
      doc.total = Math.round(100 * (doc.price || 0) * doc.quantity) / 100
      doc.taxAmount = Math.round(100 * doc.total * (doc.taxRate || 0) / 100) / 100
      doc.withHoldingTaxAmount = Math.round(100 * doc.taxAmount * (doc.withHoldingTaxRate || 0)) / 100
      doc.taxInclusiveTotal = Math.round(100 * (doc.total + doc.taxAmount - doc.withHoldingTaxAmount)) / 100

      if (!epValidateSync(doc, reject)) return
      // if (await dbModel.inventory.countDocuments({ name: doc.name, _id: { $ne: doc._id } }) > 0)
      //   return reject(`name already exists`)

      doc.save()
        .then(async newDoc => {
          await updateDespatch(dbModel, newDoc.despatch)
          let obj = await newDoc.populate([{
            path: 'item',
            populate: ['itemType', 'itemQuality']
          }])
          resolve(obj)
        })
        .catch(reject)
    } catch (err) {
      reject(err)
    }

  })
}

function deleteItem(dbModel, sessionDoc, req) {
  return new Promise(async (resolve, reject) => {
    try {
      if (!req.params.param1)
        return restError.param1(req, reject)
      const inventoryDoc = await dbModel.inventory.findOne({ _id: req.params.param1 })
      if (!inventoryDoc)
        return reject(`inventory document not found`)




      dbModel.inventory.removeOne(sessionDoc, { _id: req.params.param1 })
        .then(async result => {
          if (inventoryDoc.despatch) {
            await updateDespatch(dbModel, inventoryDoc.despatch)
          }

          resolve(result)
        })
        .catch(reject)
    } catch (err) {
      reject(err)
    }
  })
}

function updateDespatch(dbModel, despatchId) {
  return new Promise((resolve, reject) => {
    let aggregate = [
      { $match: { despatch: despatchId } },
      {
        $group: {
          _id: '$despatch',
          lineCount: { $sum: 1 },
          quantity: { $sum: '$quantity' },
          total: { $sum: '$total' },
          taxAmount: { $sum: '$taxAmount' },
          withHoldingTaxAmount: { $sum: '$withHoldingTaxAmount' },
          taxInclusiveTotal: { $sum: '$taxInclusiveTotal' },
        }
      }
    ]
    dbModel.inventory
      .aggregate(aggregate)
      .then(async result => {
        if (result.length > 0) {
          await dbModel.despatches.updateOne({ _id: result[0]._id }, {
            $set: {
              lineCount: result[0].lineCount,
              total: Math.round(100 * result[0].total) / 100,
              quantity: result[0].quantity,
              taxAmount: Math.round(100 * result[0].taxAmount) / 100,
              withHoldingTaxAmount: Math.round(100 * result[0].withHoldingTaxAmount) / 100,
              taxInclusiveTotal: Math.round(100 * (result[0].total + result[0].taxAmount - result[0].withHoldingTaxAmount)) / 100,
            }
          })
          console.log(result[0])
        }
        resolve()
      })
      .catch(reject)
  })
}