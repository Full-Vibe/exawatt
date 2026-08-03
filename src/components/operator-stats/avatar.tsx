import Image from 'next/image';
import styles from './operator-stats.module.css';

export function OperatorAvatar({
  src,
  name,
  large = false,
}: {
  src: string | null;
  name: string;
  large?: boolean;
}) {
  const className = large ? styles.profileAvatar : styles.avatar;
  if (!src) {
    return (
      <span
        className={`${className} grid place-items-center font-mono`}
        aria-hidden="true"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <Image
      unoptimized
      src={src}
      alt=""
      width={large ? 88 : 36}
      height={large ? 88 : 36}
      className={className}
    />
  );
}
