// hls.js tidak menyertakan tipe untuk subpath "light"; API-nya sama dengan build penuh.
declare module 'hls.js/light' {
  import Hls from 'hls.js';
  export default Hls;
}
