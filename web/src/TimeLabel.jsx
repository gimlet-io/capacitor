import React, { useState, useEffect } from 'react';
import { formatDistance } from "date-fns";

export function TimeLabel(props) {
  const { title, date, className } = props;
  const [label, setLabel] = useState(formatDistance(date, new Date()));

  useEffect(() => {
    const interval = setInterval(() => {
      setLabel(formatDistance(date, new Date()));
    }, 60 * 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span className={className} title={title}> {label} ago</span>
  )
}
