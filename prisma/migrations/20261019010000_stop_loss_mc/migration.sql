-- Exit karena market cap turun ke batas stop loss MC akun.
ALTER TYPE "ExitReason" ADD VALUE 'stop_loss_mc' AFTER 'stop_loss';
