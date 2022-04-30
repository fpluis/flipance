export default (ms, v) =>
  new Promise((resolve) => {
    setTimeout(resolve.bind(null, v), ms);
  });
