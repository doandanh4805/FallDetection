# FALLDETection – HỆ THỐNG PHÁT HIỆN TÉ NGÃ
#   [BÁO CÁO](Report/lab3_report)
**Nền tảng:** ESP32 DevKit V1 · MPU6050 · FreeRTOS · MQTT · Web Dashboard  
**Link mô phỏng wokwi:**  https://wokwi.com/projects/480388212233985025  

## 1. Giới thiệu

FallGuard là mô hình phát hiện té ngã sử dụng ESP32 và cảm biến gia tốc – con quay hồi chuyển MPU6050. ESP32 thu thập dữ liệu chuyển động, xử lý thuật toán phát hiện té ngã và điều khiển LED/còi cảnh báo. Dữ liệu đồng thời được gửi qua MQTT đến một giao diện Web để theo dõi trạng thái và điều khiển các đầu ra trong chế độ thủ công.

Dự án có thể chạy thử trên Wokwi. Dashboard Web có thể chạy cục bộ hoặc triển khai tĩnh bằng GitHub Pages.

## 2. Chức năng và kiến trúc

### 2.1. Chức năng chính

- Đọc dữ liệu MPU6050 qua giao tiếp I2C, mục tiêu lấy mẫu 50 mẫu/giây.
- Thu thập gia tốc ba trục `Ax`, `Ay`, `Az` và tốc độ góc ba trục `Gx`, `Gy`, `Gz`.
- Tính gia tốc tổng, góc Roll, Pitch và độ nghiêng so với tư thế đứng đã hiệu chuẩn.
- Hiển thị dữ liệu trên Serial Monitor ở tốc độ 115200 baud, chu kỳ hiển thị khoảng 500 ms.
- Gửi số đo, trạng thái phát hiện, nguồn dữ liệu và trạng thái LED/còi lên MQTT khoảng mỗi 500 ms.
- Dashboard Web nhận dữ liệu qua MQTT over WebSocket Secure (WSS), hiển thị các thẻ số liệu và hai biểu đồ.
- Dashboard hỗ trợ xác nhận cảnh báo, hiệu chuẩn lại và điều khiển LED/còi khi ở chế độ Manual.
- Thuật toán phát hiện té ngã vẫn hoạt động ở cả chế độ Auto và Manual. Khi có cảnh báo, đầu ra cảnh báo tự động được ưu tiên cao nhất.
- Việc phát hiện và cảnh báo cục bộ không phụ thuộc vào trang Web. Tác vụ lấy mẫu cảm biến chạy riêng để giảm ảnh hưởng khi MQTT mất kết nối hoặc kết nối lại.

Dự án không gửi email, SMS hoặc tự động gọi cứu hộ. Không có ứng dụng native cho điện thoại; dashboard Web có giao diện thích ứng với màn hình điện thoại.

### 2.2. Luồng hoạt động

```text
MPU6050
   │ I2C
   ▼
ESP32 – tác vụ đọc cảm biến
   │
   ├── Tính gia tốc, góc nghiêng và tốc độ góc
   │
   ▼
Thuật toán xác minh té ngã
   │
   ├── Không phát hiện ──► Tiếp tục theo dõi
   │
   └── Xác nhận té ngã ──► LED + còi cảnh báo
   │
   ▼
MQTT Broker
   │
   ▼
Web Dashboard
   ├── Hiển thị dữ liệu và biểu đồ
   ├── Hiển thị trạng thái thiết bị/cảnh báo
   └── Gửi lệnh điều khiển và xác nhận
```

## 3. Phần cứng và kết nối

### 3.1. Danh sách linh kiện

- ESP32 DevKit V1.
- Cảm biến gia tốc và con quay hồi chuyển MPU6050.
- LED đỏ và điện trở 220 Ω.
- Buzzer piezo.
- Hai nút nhấn: RESET/XÁC NHẬN và TEST FALL.

### 3.2. Bảng kết nối

| Thành phần | Chân linh kiện | ESP32 / kết nối |
|---|---|---|
| MPU6050 | VCC | 3V3 |
| MPU6050 | GND | GND |
| MPU6050 | SDA | GPIO21 |
| MPU6050 | SCL | GPIO22 |
| MPU6050 | AD0 | GND, chọn địa chỉ I2C `0x68` |
| MPU6050 | XDA, XCL, INT | Để trống trong mô hình này |
| LED đỏ | Anode (A) | GPIO26 qua điện trở 220 Ω |
| LED đỏ | Cathode (C) | GND |
| Buzzer piezo | Chân 2 (+) | GPIO27 |
| Buzzer piezo | Chân 1 (-) | GND |
| Nút RESET/XÁC NHẬN | Hai chân khác hàng | GPIO25 và GND |
| Nút TEST FALL | Hai chân khác hàng | GPIO32 và GND |

**Hình 1. Sơ đồ mạch kết nối trên Wokwi**

> **Vị trí chèn hình sơ đồ mạch Wokwi**
>
> *(Chèn ảnh sơ đồ mạch tại đây.)*

Hai nút nhấn sử dụng `INPUT_PULLUP`; khi nhấn, chân đọc được mức `LOW`. Mạch có bộ lọc nhấn 40 ms; thao tác nhấn cần duy trì tối thiểu khoảng 0,1 giây. Với nút nhấn 4 chân, hai chân nằm cùng một hàng thường đã nối điện với nhau; cần sử dụng hai chân khác hàng làm hai đầu công tắc.

MPU6050 mặc định sử dụng địa chỉ `0x68` khi chân AD0 nối GND. Nếu AD0 nối VCC, địa chỉ chuyển thành `0x69` và cần cập nhật hằng `MPU_ADDR` trong chương trình. Với module thật, cần kiểm tra mạch kéo lên I2C và bảo đảm mức logic phù hợp 3,3 V theo sơ đồ module.

## 4. Nguyên lý tính toán

### 4.1. Gia tốc tổng

Gia tốc tổng được tính từ ba thành phần gia tốc:

\[
A_g = \sqrt{A_{x,g}^{2} + A_{y,g}^{2} + A_{z,g}^{2}}
\]

Gia tốc đo được bao gồm thành phần trọng lực. Vì vậy, khi cảm biến đứng yên, độ lớn gia tốc thường xấp xỉ `1g`, không phải `0g`. Quy đổi: `1g = 9,80665 m/s²`; ngưỡng `2,5g` tương đương khoảng `24,52 m/s²`.

### 4.2. Góc Roll và Pitch

\[
Roll = atan2(A_y, A_z) \times \frac{180}{\pi}
\]

\[
Pitch = atan2(-A_x, \sqrt{A_y^2 + A_z^2}) \times \frac{180}{\pi}
\]

### 4.3. Độ nghiêng so với tư thế chuẩn

Tạo vector đơn vị từ vector gia tốc:

\[
\mathbf{u} = \frac{\mathbf{a}}{|\mathbf{a}|}
\]

Khi hiệu chuẩn, lưu vector chuẩn `u0` ở tư thế đứng. Độ nghiêng được tính theo:

\[
Tilt = acos(clamp(\mathbf{u} \cdot \mathbf{u_0}, -1, 1)) \times \frac{180}{\pi}
\]

Độ đổi hướng sau va đập được tính bằng góc giữa vector gia tốc gần tĩnh sau va đập và vector gần 0,5 giây trước va đập. Lịch sử hợp lệ được chọn trong khoảng 0,5–1,5 giây trước đó; nếu không có dữ liệu phù hợp thì dùng tư thế chuẩn.

### 4.4. Giới hạn của phép đo

- Web chỉ hiển thị góc khi gia tốc tổng nằm trong khoảng `0,8–1,2g` và cảm biến đã hiệu chuẩn.
- Khi va đập hoặc chuyển động mạnh, góc suy ra từ gia tốc không đáng tin cậy; Web hiển thị `—` thay vì dùng góc đó để kết luận.
- Serial vẫn in giá trị góc gần tĩnh gần nhất kèm `valid=0` khi mẫu hiện tại không hợp lệ.
- Gyroscope đo **tốc độ góc** (°/s), không phải góc (°). Thay đổi thanh trượt Rotation trong Wokwi không trực tiếp đặt góc nghiêng.
- Dự án ước lượng góc từ hướng trọng lực ở trạng thái gần tĩnh; không tích phân gyro để tạo góc yaw và không sử dụng bộ lọc hợp nhất tư thế đầy đủ.

MPU6050 được cấu hình dải gia tốc ±8g, độ nhạy 4096 LSB/g; dải gyro ±500°/s, độ nhạy 65,5 LSB/(°/s). Chương trình đọc I2C trực tiếp bằng `Wire`, có kiểm tra số byte và lỗi giao tiếp; không yêu cầu thư viện Adafruit MPU6050.

## 5. Thuật toán phát hiện té ngã

### 5.1. Hiệu chuẩn ban đầu

Giữ cảm biến đứng yên ở tư thế đại diện cho trạng thái đứng trong khoảng 2 giây. Trong Wokwi, trạng thái mặc định là `Ax=0`, `Ay=0`, `Az=1g`, các giá trị gyro bằng 0.

Điều kiện hiệu chuẩn cần khoảng 100 mẫu liên tục thỏa mãn:

- Gia tốc tổng trong khoảng `0,9–1,1g`.
- Độ lớn gyro nhỏ hơn `8°/s`.
- Độ đổi hướng giữa hai mẫu không quá `3°`.

Khi đạt yêu cầu, hệ thống lưu tư thế chuẩn và chuyển sang trạng thái `READY`. Đây là hiệu chuẩn tư thế, không phải hiệu chuẩn đầy đủ sai số cảm biến theo nhiều trục.

### 5.2. Điều kiện xác minh và báo động

| Bước | Điều kiện | Hành động |
|---|---|---|
| 1. Va đập | `A_g ≥ 2,5g` | Chuyển sang `VERIFY`, lưu đỉnh va đập và hướng trước va đập |
| 2. Tư thế sau va đập | Trong cửa sổ 2,5 giây, độ nghiêng so với chuẩn `≥ 60°` và độ đổi hướng so với trước va đập `≥ 45°` | Tiếp tục xác minh |
| 3. Giữ tư thế | Các điều kiện trên liên tục ít nhất 1,2 giây; `A_g` trong `0,8–1,2g`; độ lớn gyro `< 30°/s` | Xác nhận trạng thái |
| 4. Báo động | Tất cả điều kiện xác minh được thỏa mãn | Chuyển `ALARM`, tăng bộ đếm sự kiện một lần, LED nhấp nháy và còi 1.800 Hz kêu ngắt quãng |
| 5. Hủy xác minh | Không thỏa điều kiện trong cửa sổ 2,5 giây | Trở về `READY`, không phát báo động |

Nếu khoảng cách giữa hai mẫu vượt 100 ms, quá trình xác minh đang diễn ra bị hủy để tránh xem khoảng thời gian mất mẫu là thời gian bất động. Nếu không có mẫu hợp lệ quá 200 ms hoặc giao tiếp I2C lỗi, hệ thống báo `SENSOR_FAULT`. Lỗi cảm biến không được xem là trạng thái “không té ngã”.

Trạng thái `ALARM` được giữ cho đến khi người dùng nhấn RESET trên mạch hoặc xác nhận trên Web. Lỗi cảm biến xuất hiện sau khi đã báo động không tự xóa trạng thái báo động. Bộ đếm sự kiện bao gồm cả các bài TEST, chỉ lưu trong RAM và trở về 0 sau khi khởi động lại.

**Giới hạn thuật toán:** Các ngưỡng trên do dự án lựa chọn để minh họa nguyên lý, không phải bộ ngưỡng được chứng nhận. Hệ thống có thể bỏ sót ngã nhẹ, trượt ngồi hoặc ngã không làm thay đổi tư thế đủ lớn; cũng có thể báo nhầm khi thiết bị bị làm rơi hoặc có va chạm rồi nằm xuống. Cảm biến cần được gắn chắc ở vị trí phù hợp, thường là vùng thân/eo. Không thể áp dụng trực tiếp các ngưỡng này cho mọi vị trí đeo.

### 5.3. Chế độ Auto và Manual

| Chế độ / trạng thái | Hoạt động |
|---|---|
| Auto, không có `ALARM` | LED và còi tắt |
| Auto, có `ALARM` | LED nhấp nháy theo chu kỳ 0,5 giây; còi kêu 350 ms mỗi giây |
| Manual | Hai nút Web điều khiển LED và còi độc lập; có thể bật đồng thời |
| Manual không có lệnh mới trong 60 giây | Tự trở lại Auto |
| Có `ALARM` trong Manual | Cảnh báo tự động ghi đè lệnh Manual; cần xác nhận để xóa cảnh báo |
| `SENSOR_FAULT` | Hủy yêu cầu Manual; LED nháy ngắn mỗi 1,5 giây để báo lỗi, còi không kêu. Nếu `ALARM` đã được giữ từ trước thì cảnh báo tiếp tục |

Các trường `led` và `buzzer` trên MQTT biểu diễn yêu cầu hoạt động logic. Trong `ALARM`, chúng luôn là `true`, trong khi chân GPIO thực tế nhấp nháy hoặc phát âm theo chu kỳ. Dashboard mô tả trạng thái hoạt động theo logic này, không cập nhật theo từng lần bật/tắt xung GPIO.

## 6. Xử lý lỗi thường gặp

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| `FallDetector.h: No such file` | Tạo tab đúng tên `FallDetector.h`, phân biệt chữ hoa/thường; không để tên thành `.h.txt`. |
| Không tìm thấy `PubSubClient` hoặc `ArduinoJson` | Kiểm tra `libraries.txt` hoặc cài thư viện bằng Library Manager. |
| `SENSOR_FAULT` hoặc số đo không đổi | Kiểm tra VCC/GND, SDA GPIO21, SCL GPIO22, AD0 nối GND và địa chỉ `0x68`. |
| `CALIBRATING` không kết thúc | Đặt `Ax=0`, `Ay=0`, `Az=1`, các trục gyro bằng 0 và giữ cảm biến yên khoảng 2 giây mô phỏng. |
| Thay đổi Rotation nhưng góc không như mong đợi | Rotation biểu diễn °/s; thay đổi vector gia tốc để mô phỏng tư thế gần tĩnh. |
| Chỉ nghiêng 90° nhưng không báo động | Đây là hành vi dự kiến: thuật toán yêu cầu có va đập trước đó và các điều kiện thời gian tương ứng. |
| Va/chạm cảm biến nhưng không báo động | Kiểm tra xem sau va đập có tư thế phù hợp và có giữ ổn định đủ thời gian hay không. |
| TEST bị từ chối | Đợi `READY`, xác nhận cảnh báo cũ và đợi bài TEST trước kết thúc. |
| Hết TEST 5 giây nhưng còi vẫn kêu | `ALARM` được giữ; nhấn RESET trên mạch hoặc Xác nhận trên Web. |
| Không thể tắt còi bằng Manual khi có `ALARM` | Cảnh báo tự động có ưu tiên cao hơn; cần xác nhận cảnh báo. |
| Web đã kết nối MQTT nhưng ESP32 chưa trực tuyến | Kiểm tra Wokwi, Serial có báo MQTT OK không, Base topic có trùng không và chờ hai gói trạng thái mới. |
| Nút điều khiển bị khóa | Cần thiết bị trực tuyến, cảm biến hợp lệ và hiệu chuẩn hoàn tất. LED/còi yêu cầu chế độ Manual và không có `ALARM`. |
| MQTT nhận dữ liệu chậm | Wokwi có thể chạy chậm hơn thời gian thực; kiểm tra đồng hồ mô phỏng và kết nối Internet. |
| Mất kết nối broker | Đọc cảm biến và cảnh báo Auto vẫn chạy cục bộ; broker công cộng không bảo đảm thời gian hoạt động. |
| Trễ hoặc mất mẫu trên 100 ms | Theo dõi `max_sample_gap_ms` và `missed_samples`; cần đánh giá hiệu năng/FIFO trước khi dùng thật. |
