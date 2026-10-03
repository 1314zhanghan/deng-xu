"""
把一段文本渲染成终端 ASCII 二维码。

为什么用 Python：`qrcode` 是会随本项目便携运行时一起安装的纯 Python 库，
用它可以在本地直接算出二维码矩阵，不依赖任何在线服务，
因此断网、内网、被墙的环境下都能正常出码。

用法： python qrterm.py "<要编码的文本>"
输出： 每行一个字符串，'#' 表示黑块，'.' 表示白块，已含二维码标准要求的静默区。
      由 PowerShell 侧负责染色，本脚本不输出颜色控制符，便于重定向。
"""

import sys

try:
    import qrcode
except ImportError:
    sys.exit(3)


def main():
    if len(sys.argv) < 2:
        sys.exit(2)
    text = sys.argv[1]

    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=1,
        border=2,
    )
    qr.add_data(text)
    qr.make(fit=True)
    matrix = qr.get_matrix()          # 二维 bool 列表，True = 黑
    for row in matrix:
        sys.stdout.write(''.join('#' if cell else '.' for cell in row) + '\n')


if __name__ == '__main__':
    main()
