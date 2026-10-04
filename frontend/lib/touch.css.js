/**
 * Règles communes à toutes les pages pour les écrans tactiles (téléphones et tablettes, iOS et Android).
 * Injectées à la fin de chaque feuille de style de page : `${TOUCH_CSS}`.
 *
 *  - iOS zoome automatiquement sur un champ dont la police fait moins de 16 px : on impose 16 px.
 *  - Cibles tactiles : 40 px minimum (Apple recommande 44, Android 48) sur les boutons compacts.
 *  - Focus clavier visible, pas de surbrillance bleue au tap, défilement horizontal fluide.
 *  - Hauteurs d'écran : dvh (barre d'adresse mobile) avec repli vh pour les anciens navigateurs.
 */
export const TOUCH_CSS = `
  *{-webkit-tap-highlight-color:transparent;}
  :focus-visible{outline:2px solid #FF6B2C;outline-offset:2px;}
  img{max-width:100%;}
  @media(pointer:coarse){
    input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]),select,textarea{font-size:16px!important;}
    .filter-chip,.pill-btn,.mini-tab,.advance-btn,.btn-primary,.btn-secondary,.type-btn,.cuisine-chip,.cat-tab,.rc-edit-btn,.topbar-state,.alert-pill,.staff-btn,.confirm-home-btn,.order-pill{min-height:40px;}
    .icon-btn,.icon-btn-sm,.act-btn,.ci-delete-btn,.pwd-toggle,.photo-thumb-x,.photo-thumb-cover,.nav-icon-btn,.back-btn,.back-btn-white,.pub-back-btn,.icon-btn-top,.notif-close{min-width:40px!important;min-height:40px!important;}
    .qty-ctrl button,.ci-qty-ctrl button,.counter-item button,.cq-btn{min-width:40px;min-height:40px;}
    .link-btn,.btn-link{padding:10px 4px;display:inline-block;}
    .pin-key{min-height:52px;}
    .search-input-wrap button{min-width:36px;min-height:36px;}
    .avail-btn,.reorder-btn{min-height:36px;}
    input[type=checkbox],input[type=radio]{width:22px!important;height:22px!important;}
  }
  @media(max-width:380px) and (pointer:coarse){
    .icon-btn-sm,.act-btn{min-width:36px!important;min-height:36px!important;}
  }
  @media(max-width:900px){
    .table-wrap,.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;}
  }
  @media(max-width:900px){
    .sidebar,.sidebar.collapsed{overflow:hidden;}
    .sb-nav{min-width:0;}
    .sb-nav .sb-item{min-width:0;overflow:hidden;}
  }
  @media(max-width:360px){
    .form-3col,.form-2col{grid-template-columns:1fr!important;}     /* deux champs heure ne tiennent pas côte à côte sur 320 px */
  }
  @media(max-width:600px){
    .form-3col>div,.form-2col>div{min-width:0;}
    input[type=time],input[type=date]{min-width:0;max-width:100%;}
    .tbl,.table-wrap table{min-width:560px;}                 /* les tableaux défilent au lieu de s'écraser */
    .toast-fixed{left:12px;right:12px;max-width:none;}
  }
  @media(max-height:520px) and (orientation:landscape){
    .login-wrap{align-items:flex-start;padding-top:12px;}
  }
`;
