function handler(event) {
  var req = event.request;
  var uri = req.uri;

  // strip the /trade prefix
  if (uri === '/trade' || uri === '/trade/') {
    req.uri = '/index.html';
    return req;
  }
  if (uri.indexOf('/trade/') === 0) {
    uri = uri.substring(6); // remove "/trade"
  } else {
    return req;
  }

  // route directories or extensionless paths to /index.html
  if (uri.endsWith('/')) {
    uri += 'index.html';
  } else {
    var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
    if (lastSegment.indexOf('.') === -1) {
      uri += '/index.html';
    }
  }

  req.uri = uri;
  return req;
}
