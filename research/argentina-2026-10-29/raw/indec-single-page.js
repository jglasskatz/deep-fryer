$(document).ready(function () {
    $('html,body').animate({ scrollTop: 0 }, 'normal');
    $("#content").fadeOut(0);
    //var arrayUrlNav = window.decodeURI(window.location.href.split('/').pop());
    //var VistaCarga = arrayUrlNav.replace(/-/g, "/");
    var VistaCarga = $('#VistaCarga').val();
    if (VistaCarga.indexOf("Buscador") != -1) {
        $('#ResultadosBusquedaCargando').fadeIn('normal');
        var arrayUrl = window.decodeURI(window.location.href.split('/').pop()).split("-");
        var Temas = "Todo";
        var Categorias = "Todo";
        var Orden = "Relevantes";
        var FiltroBusqueda = "";
        $('#ResultadosBusquedaCargando').find('span').text(arrayUrl[3].replace(/_/g, " "));
        if (arrayUrl[3] != null && arrayUrl[3] != "") {
            FiltroBusqueda = arrayUrl[3].replace("/", "dMy").replace("/", "dMy").replace("/", "dMy");
        }
        if (arrayUrl[6] == "Nuevos") {
            $('#buscadorfiltros').find('.a-color3-active3').removeClass('a-color3-active3');
            $('#filtroNuevos').addClass('a-color3-active3');
            Orden = "Nuevos";
        }
        if (arrayUrl[6] == "Antiguos") {
            $('#buscadorfiltros').find('.a-color3-active3').removeClass('a-color3-active3');
            $('#filtroAntiguos').addClass('a-color3-active3');
            Orden = "Antiguos";
        }

        if (arrayUrl[5] != "Todo") {
            $('#Temas').find('.a-color2-active').removeClass('a-color2-active');
            var valor = arrayUrl[5].replace(/_/g, " ");
            $('#Temas').find('[data-valor=' + valor + ']').addClass('a-color2-active');
            Temas = arrayUrl[5];
        }
        if (arrayUrl[4] != "Todo") {
            $('#Categorias').find('.a-color2-active').removeClass('a-color2-active');
            var valor = arrayUrl[4].toString().replace(/_/g, " ");
            $('#Categorias').find('[data-valor=' + valor + ']').addClass('a-color2-active');
            Categorias = arrayUrl[4];
        }

        var View = "Buscador/Buscador/" + "1" + "/" + FiltroBusqueda + "/" + Categorias + "/" + Temas + "/" + Orden;
        window.history.pushState('', '', "/indec/web/" + View.replace("/", "-").replace("/", "-").replace("/", "-").replace("/", "-").replace("/", "-").replace("/", "-").replace("/", "-"));
    }
    if (VistaCarga != null && VistaCarga != "" && VistaCarga != "/undefined/undefined/1") {
        $("#content").load("/" + VistaCarga, function () {
            responsiveChanges();
            $('#loadingDiv').fadeOut('normal', function () {
                $('#ResultadosBusquedaCargando').fadeOut('normal');
                $('#ResultadosBusquedaCargando').find('span').text("");
                $("#content").fadeIn('normal');
            });
        });
        $('#VistaCarga').val("");
    } else {

        $("#content").load("/indec/Portada", function () {
            window.history.pushState('', '', '/');
            responsiveChanges();
            $('#loadingDiv').fadeOut('normal', function () {
                $('#ResultadosBusquedaCargando').fadeOut('normal');
                $('#ResultadosBusquedaCargando').find('span').text("");
                $("#content").fadeIn('normal');
            });
        });
    }

    $('.nav2 .dropdown').hover(function () {
        $(this).find('.dropdown-menu').first().stop(true, true).delay(100).slideDown(300);
    }, function () {
        $(this).find('.dropdown-menu').first().stop(true, true).delay(100).slideUp(0);
        });
    $('.nav-drop').on('click', function () {
        $(this).parent().parent().parent().parent().parent().parent().parent().slideUp(0);
    })
    $('.nav-link').on('click', function () {
        if ($(document).width() < 992) {
            if ($(this).parent().find('.dropdown-menu').css('display') != 'none') {
                $(this).parent().find('.dropdown-menu').stop(true, true).delay(100).slideUp(300);
            } else {
                $(this).parent().find('.dropdown-menu').stop(true, true).delay(100).slideDown(300);
            }
        }
    })
    $('.menu-resp').on('click', function () {
        if ($(document).width() < 992) {
            var elem = $(this).parent().parent().find('.drop-hide').attr('id');
            $(this).parent().parent().find('.drop-hide').stop(true, true).delay(100).slideToggle(300);
            $(this).parent().parent().parent().parent().find('.drop-hide').each(function () {
                if ($(this).attr('id') != elem) {
                    $(this).stop(true, true).delay(100).slideUp(300);
                }
            })
        }
    })
    $(window).scroll(function () {
        if ($(window).scrollTop() == 0) {
            $('.scrollTop').fadeOut(300);
        } else {
            if ($('.scrollTop').css('display') == "none") {
                $('.scrollTop').fadeIn(300);
            }
        }
    })
    $(window).resize(function () {
        responsiveChanges();
    });
    $("body").tooltip({ selector: '[data-toggle=tooltip]' });

    $(window).on('popstate', function () {
        //window.history.replaceState(null, null, "");
        window.location.reload();
    });

    $('.buscador').on('focus', function (e) {
        $(document).on('keypress', function (e) {
            if (e.which == 13 && $('.buscador').val() != "") {
                $('.buscador').parent().find('#basic-addon2').click();
            }
        });
    });
    $('.buscadorIn2').on('keyup', function () {
        $('.buscador').val($('.buscadorIn2').val());
    });
    $('.buscadorIn2').on('focus', function () {
        $('.buscador').val($('.buscadorIn2').val());
        $(document).on('keypress', function (e) {
            if (e.which == 13 && $('.buscador').val() != "") {
                $('.buscador').parent().find('#basic-addon2').click();
            }
        });
    });

})

function responsiveChanges() {
    if ($(document).width() > 558) {
        $('body').find('.hide-noticia').each(function () {
            $(this).slideDown(0);
        })
        $('#btn-noticia').text("OCULTAR NOTICIAS");
        $('.show-responsive').css('display', 'none');
    } else {
        $('body').find('.hide-noticia').each(function () {
            $(this).slideUp(0);
        })
        $('#btn-noticia').text("VER MÁS NOTICIAS");
        $('.show-responsive').css('display', '');
    }
    if ($(document).width() > 991) {
        $('body').find('.drop-hide').each(function () {
            $(this).delay(0).slideDown(0);
        })
        $('body').find('.tooltip-resp').each(function () {
            $(this).attr('data-toggle', 'tooltip');
        })
    } else {
        $('body').find('.tooltip-resp').each(function () {
            $(this).removeAttr('data-toggle');
        })
        $('.tooltip').removeClass('show');
    }
    var find = "" + $('body').find('.selectpicker').html();
    if (find != "" && find != "undefined" && find != null) {
        $('.selectpicker').selectpicker('refresh');
    }
    
}

function navpage(e) {
    var View = $(e).attr('data-view');

    if (View === 'Portada') {
        window.location.href = '/';
	return;
    }

    if ($(document).width() < 992 && $('#navbarSupportedContent').hasClass('show')) {
        $('.navbar-toggler').click();
    }
    if (View.indexOf("Buscador") != -1) {
        $('#ResultadosBusquedaCargando').fadeIn('normal');
        $('#ResultadosBusquedaCargando').find('span').text($('.buscador').val());
    } else {
        $('#ResultadosBusquedaCargando').fadeOut('normal');
        $('#ResultadosBusquedaCargando').find('span').text("");
    }
    $('html,body').animate({ scrollTop: 0 }, 'normal'); 
    $('#content').fadeOut('normal', function () {
        $('#loadingDiv').fadeIn('normal', function () {
            if (View == "Portada") {
                View = "";
                window.history.pushState('', '', '/');
                $('#content').load(View, function () {
                    responsiveChanges();
                    $('#loadingDiv').fadeOut('normal', function () {
                        
                            //window.history.pushState('', '', '/');
                        $("#content").fadeIn('normal');
                    });
                });
            } else {
                $('#content').load("/" + View, function () {
                    responsiveChanges();
                    $('#loadingDiv').fadeOut('normal', function () {
                            window.history.pushState('', '', "/indec/web/" + View.replace("/", "-").replace("/", "-").replace("/", "-").replace("/", "-").replace("/", "-"));

                            $('#ResultadosBusquedaCargando').fadeOut('normal');
                            $('#ResultadosBusquedaCargando').find('span').text("");
                            $("#content").fadeIn('normal');

                    });
                });
            }

            
        })
    });
}

function navpageb(e) {
    
    var View = $(e).attr('data-view');
    //if ($('.buscador').val().length < 3) { return; }
     //**************************************************************************************************************************************************************************************************************************************************************
   //validacion regex
    var str = $('.buscador').val();
    var espacios = " ";
    str = str.replace(new RegExp(espacios, "g"), "-");
     var pattInt = new RegExp(/[A-Za-z0-9]/);
    var auxiliar = "";
    var normalizado = str.normalize('NFD').replace(/[\u0300-\u036f]/g, "");
    console.log("normalizado:", normalizado);
    //........................................................
    for (i = 0; i < normalizado.length; i++) {
        var caract = normalizado.substr(i, 1);

        if (normalizado[i].toString() == "-") {
            auxiliar = auxiliar + normalizado[i].toString();
        }

        var resInt = pattInt.test(caract);
        if (resInt == true) {
            auxiliar = auxiliar + normalizado[i].toString();
        }

        console.log("auxiliar :", auxiliar)
    }

    if (auxiliar.length > 0) {
        var palabrasAEliminar = ['sql', 'indec', 'html', '<', '>', 'if', 'and', 'or'];
        var textPorPalabra = [];
        var auxiliarDepurado = [];
        textPorPalabra = auxiliar.split("-");
       auxiliar = "";
        var c = 0;
        for (c = 0; c < textPorPalabra.length; c++) {
            console.log("textPorPalabra:", textPorPalabra[c].toString())
            if (palabrasAEliminar.indexOf(textPorPalabra[c].toString()) < 1) {
                auxiliarDepurado.push(textPorPalabra[c].toString());
            }
        }
        for (c = 0; c < auxiliarDepurado.length; c++) {
            console.log("auxiliarDepurado:", auxiliarDepurado[c].toString())

            if (c == 0) { auxiliar = auxiliar + auxiliarDepurado[c].toString(); }
            else { auxiliar = auxiliar + "-" + auxiliarDepurado[c].toString();}
            
        }
        console.log("auxiliar:", auxiliar)
    }
    //fin validacion
    //**************************************************************************************************************************************************************************************************************************************************************
    var BuscadorVal = "";
    var BuscadorLeyenda = "";
    //$('.buscador').val($('.buscador').val().replace(/\_/g, " ").replace(/\!/g, "").replace(/\¡/g, "").replace(/\?/g, "").replace(/\¿/g, "").replace(/\-/g, " ").replace(/\+/g, "").replace(/\@/g, "").replace(/\./g, " ").replace(/\&/g, "").replace(/\'/g, "").replace(/,/g, "").replace(/:/g, "").replace(/;/g, "").replace(/-/g, " ").replace(/\$/g, "").replace(/#/g, "").replace(/%/g, "").replace(/\*/g, "").trim());

    if (auxiliar != null && auxiliar != "")
    /*if ($('.buscador').val() != null && $('.buscador').val().trim() != "")*/
    {
        BuscadorLeyenda = auxiliar.replace(new RegExp("-", "g"), " ");
        $('.buscarDato').attr('onclick', '');
        //if ($('.buscador').val().trim() != "" && $('.buscador').val() != null)
        if (auxiliar.trim() != "" && auxiliar != null) {
            //View += "/" + $('.buscador').val().replace(/ /g, "_").replace("/", "dMy").replace("/", "dMy").replace("/", "dMy").trim();
            //BuscadorVal = $('.buscador').val().trim();
            View += "/" + auxiliar.trim();
            BuscadorVal = auxiliar.trim();           
        } else
        {
            View += "/" + "#";
            BuscadorVal = "";
        }

            View += "/" + "Todo";


            View += "/" + "Todo";
 

            View += "/" + "Relevantes";

        if ($(document).width() < 992 && $('#navbarSupportedContent').hasClass('show')) {
            $('.navbar-toggler').click();
        }
        if (View.indexOf("Buscador") != -1) {
            $('#ResultadosBusquedaCargando').fadeIn('normal');
            if (auxiliar.length < 3) {
                $('#ResultadosBusquedaCargando').find('span').text("Debe ingresar al menos 3 caracteres (letras y/o números ) para realizar una búsqueda");
                //return;
            } else
            {
                $('#ResultadosBusquedaCargando').find('span').text("Buscando Resultados para... " + BuscadorLeyenda);
            }
            
        } else {
            $('#ResultadosBusquedaCargando').fadeOut('normal');
            $('#ResultadosBusquedaCargando').find('span').text("Buscando Resultados para... " + "");
        }

        $('html,body').animate({ scrollTop: 0 }, 'normal');
        $('#content').fadeOut('normal', function () {
            
            $('#loadingDiv').fadeIn('normal', function () {
                $('#loadingDiv div.lds-spinner').fadeIn('normal');
                window.history.pushState('', '', "/indec/web/" + View.replace("/", "-").replace("/", "-").replace("/", "-").replace("/", "-").replace("/", "-").replace("/", "-"));

                if (auxiliar.length < 3) {
                    $('#loadingDiv div.lds-spinner').fadeOut('normal');
                    // ultima modificacion
                    $('#content').load("/" + View, function () {
                        responsiveChanges();
                    });
                } else {
                        $('#content').load("/" + View, function () {
                        responsiveChanges();
                        $('#loadingDiv').fadeOut('normal', function () {
                            $('#ResultadosBusquedaCargando').fadeOut('normal');
                            $('#ResultadosBusquedaCargando').find('span').text("Buscando Resultados para... " + "");
                            $("#content").fadeIn('normal');
                        });
                    });
                }
            });
        });
    }
}

function scrollTopPage() {
    $('html,body').animate({ scrollTop: 0 }, 'normal');
}

function abrirSitioAnterior() {
    window.open('http://sitioanterior.indec.gob.ar/', '_blank');
}
