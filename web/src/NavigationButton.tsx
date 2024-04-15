import React from 'react';

export type NavigationButtonProps = {
  handleNavigation: () => void;
};

export function NavigationButton(props) {
  const { handleNavigation, children } = props;
  return (
    <button className="hover:text-neutral-700" onClick={handleNavigation}>
      <span>{children}</span>
    </button>
  );
};
